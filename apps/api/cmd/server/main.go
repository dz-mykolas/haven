package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/httpapi"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("Haven stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("set DATABASE_URL (see .env.example)")
	}
	addr := os.Getenv("HAVEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return errors.New("this development build must listen on loopback; add authentication before public deployment")
	}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	defer listener.Close()
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	s, err := store.Open(startup, url)
	cancel()
	if err != nil {
		return err
	}
	defer s.Pool.Close()
	reviewCtx, stopReviews := context.WithCancel(ctx)
	reviewsDone := make(chan struct{})
	go func() { defer close(reviewsDone); s.RunReviews(reviewCtx) }()
	defer func() { stopReviews(); <-reviewsDone }()
	followUpsDone := make(chan struct{})
	go func() { defer close(followUpsDone); s.RunFollowUps(reviewCtx) }()
	defer func() { stopReviews(); <-followUpsDone }()
	origins := os.Getenv("HAVEN_ORIGINS")
	if origins == "" {
		origins = "http://127.0.0.1:4321,http://localhost:4321"
	}
	bankClient, err := banking.FromEnv()
	if err != nil {
		return err
	}
	server := &http.Server{Addr: addr, Handler: httpapi.New(s, strings.Split(origins, ","), bankClient), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second}
	errCh := make(chan error, 1)
	go func() { slog.Info("Haven API ready", "address", addr); errCh <- server.Serve(listener) }()
	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
