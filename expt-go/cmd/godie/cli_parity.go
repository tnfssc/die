package main

import (
	"fmt"
	"os"
	"path/filepath"

	"godie/internal/app"
)

// applyCLIParity handles CLI-only operations and prepares options before NewApplication.
// It returns handled for commands, such as --export, that should exit successfully.
func applyCLIParity(o *app.Options) (handled bool, err error) {
	cwd := o.CWD
	if cwd == "" {
		cwd, err = os.Getwd()
		if err != nil {
			return false, err
		}
	}
	cwd, err = filepath.Abs(cwd)
	if err != nil {
		return false, err
	}
	dir := o.SessionDir
	if dir == "" {
		dir = filepath.Join(o.StateDir, "sessions")
	}
	if o.Export != "" {
		match, e := app.ResolveSessionArgument(o.Export, cwd, dir)
		if e != nil {
			return false, e
		}
		output := ""
		if len(o.Messages) > 0 {
			output = o.Messages[0]
		}
		output, e = app.ExportSessionHTML(match.Path, output)
		if e != nil {
			return false, e
		}
		fmt.Printf("Exported to: %s\n", output)
		return true, nil
	}
	prepared, err := app.PrepareCLIOptions(*o)
	if err != nil {
		return false, err
	}
	*o = prepared
	return false, nil
}
