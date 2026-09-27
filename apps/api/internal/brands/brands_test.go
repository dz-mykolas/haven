package brands

import "testing"

func TestMatchesBrandsByWholeWords(t *testing.T) {
	for name, slug := range map[string]string{
		"Netflix":           "netflix",
		"PAYPAL *NETFLIX":   "netflix",
		"Spotify Premium":   "spotify",
		"Apple iCloud+":     "icloud",
		"Discord Nitro":     "discord",
		"Bitwarden Premium": "bitwarden",
		"Booking.com":       "bookingdotcom",
		"LIDL LIETUVA":      "lidl",
		"Revolut":           "revolut",
		"steam purchase":    "steam",
	} {
		icon, ok := Match(name)
		if !ok || icon.Slug != slug {
			t.Errorf("Match(%q) = %q, %v; want %q", name, icon.Slug, ok, slug)
		}
		if icon.Path == "" || icon.Hex == "" {
			t.Errorf("Match(%q) returned an icon without artwork", name)
		}
	}
}

func TestLeavesUnknownAndEverydayNamesUnmatched(t *testing.T) {
	for _, name := range []string{
		"Apartment rent", "Barber in Vilnius (synthetic)", "JUDU 30-day public transport pass",
		"Lietuvos draudimas", "Vilniaus šilumos tinklai", "Talutti", "Huracán Coffee",
		"Transfer", "Daily", "Fresh Post", "Marconi Express", "Gym+", "", "  ",
	} {
		if icon, ok := Match(name); ok {
			t.Errorf("Match(%q) = %q; want no match", name, icon.Slug)
		}
	}
}
