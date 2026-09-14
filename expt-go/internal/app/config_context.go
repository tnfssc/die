package app

// configuredContextWindow shares the effective model catalog between the
// compaction threshold and footer; configured overrides must affect both.
func configuredContextWindow(stateDir, provider, model string) (int, error) {
	models, err := ModelsForState(stateDir)
	if err != nil {
		return 0, err
	}
	for _, m := range models {
		if m.Provider == provider && m.ID == model {
			return m.ContextWindow, nil
		}
	}
	return 0, nil
}
