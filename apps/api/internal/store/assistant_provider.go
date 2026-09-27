package store

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
)

var keyLock sync.Mutex

// The wrapping key lives outside PostgreSQL and JSON exports. Tests override its
// path; deployments must retain this file alongside their database backup.
func providerCipher(create bool) (cipher.AEAD, error) {
	keyLock.Lock()
	defer keyLock.Unlock()
	path := os.Getenv("HAVEN_LLM_KEY_FILE")
	if path == "" {
		path = filepath.Join(".secrets", "llm-encryption.key")
	}
	key, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) && create {
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return nil, errors.New("Could not create the model key directory")
		}
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		var f *os.File
		f, err = os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(err, os.ErrExist) {
			key, err = os.ReadFile(path)
		} else if err == nil {
			_, err = f.Write(key)
			if closeErr := f.Close(); err == nil {
				err = closeErr
			}
		}
	}
	if err != nil || len(key) != 32 {
		return nil, errors.New("Could not read the model encryption key. Restore the key file or replace the saved API key")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func (s *Store) AssistantProvider(ctx context.Context) (assistant.Provider, error) {
	var p assistant.Provider
	err := s.Pool.QueryRow(ctx, `SELECT base_url,model,protocol,octet_length(api_key_cipher)>0,version,tested_at FROM assistant_provider WHERE singleton`).Scan(&p.BaseURL, &p.Model, &p.Protocol, &p.HasAPIKey, &p.Version, &p.TestedAt)
	return p, err
}
func (s *Store) ProviderCredentials(ctx context.Context) (assistant.Provider, string, error) {
	var p assistant.Provider
	var encrypted []byte
	err := s.Pool.QueryRow(ctx, `SELECT base_url,model,protocol,api_key_cipher,version,tested_at FROM assistant_provider WHERE singleton`).Scan(&p.BaseURL, &p.Model, &p.Protocol, &encrypted, &p.Version, &p.TestedAt)
	if err != nil {
		return p, "", err
	}
	p.HasAPIKey = len(encrypted) > 0
	if !p.HasAPIKey {
		return p, "", nil
	}
	aead, err := providerCipher(false)
	if err != nil {
		return p, "", err
	}
	if len(encrypted) < aead.NonceSize() {
		return p, "", errors.New("Saved model key is unreadable; replace it in settings")
	}
	key, err := aead.Open(nil, encrypted[:aead.NonceSize()], encrypted[aead.NonceSize():], []byte(p.BaseURL))
	if err != nil {
		return p, "", errors.New("Saved model key is unreadable; replace it in settings")
	}
	return p, string(key), nil
}
func (s *Store) SaveAssistantProvider(ctx context.Context, in assistant.ProviderUpdate) (assistant.Provider, error) {
	if err := in.Validate(); err != nil {
		return assistant.Provider{}, bad(err.Error())
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return assistant.Provider{}, err
	}
	defer tx.Rollback(ctx)
	var oldURL string
	var encrypted []byte
	var version int64
	err = tx.QueryRow(ctx, `SELECT base_url,api_key_cipher,version FROM assistant_provider WHERE singleton FOR UPDATE`).Scan(&oldURL, &encrypted, &version)
	if err != nil {
		return assistant.Provider{}, err
	}
	if in.Version != version {
		return assistant.Provider{}, conflict(version)
	}
	if oldURL != in.BaseURL && len(encrypted) > 0 && in.APIKey == nil {
		return assistant.Provider{}, bad("Enter an API key for the new endpoint, or remove the saved key")
	}
	if in.APIKey != nil {
		encrypted = []byte{}
		if *in.APIKey != "" {
			aead, err := providerCipher(true)
			if err != nil {
				return assistant.Provider{}, err
			}
			nonce := make([]byte, aead.NonceSize())
			if _, err = rand.Read(nonce); err != nil {
				return assistant.Provider{}, err
			}
			encrypted = aead.Seal(nonce, nonce, []byte(*in.APIKey), []byte(in.BaseURL))
		}
	}
	_, err = tx.Exec(ctx, `UPDATE assistant_provider SET base_url=$1,model=$2,protocol=$3,api_key_cipher=$4,version=version+1,tested_at=NULL WHERE singleton`, in.BaseURL, in.Model, in.Protocol, encrypted)
	if err != nil {
		return assistant.Provider{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return assistant.Provider{}, err
	}
	return s.AssistantProvider(ctx)
}
func (s *Store) MarkProviderTest(ctx context.Context, version int64, success bool) error {
	command := `UPDATE assistant_provider SET tested_at=NULL WHERE singleton AND version=$1`
	if success {
		command = `UPDATE assistant_provider SET tested_at=now() WHERE singleton AND version=$1`
	}
	result, err := s.Pool.Exec(ctx, command, version)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return bad("The connection changed while testing. Test the new settings")
	}
	return nil
}
func (s *Store) RemoveAssistantProvider(ctx context.Context, version int64) error {
	result, err := s.Pool.Exec(ctx, `UPDATE assistant_provider SET base_url='',model='',protocol='chat_completions',api_key_cipher='',tested_at=NULL,version=version+1 WHERE singleton AND version=$1`, version)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return &Error{409, "The connection changed. Reload settings"}
	}
	return nil
}
