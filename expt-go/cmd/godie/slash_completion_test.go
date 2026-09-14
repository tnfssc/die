package main

import (
	"godie/internal/resources"
	"testing"
)

func TestResourceSlashCommandsExposeTemplatesAndSkills(t *testing.T) {
	got := resourceSlashCommands(resources.Set{Templates: []resources.Template{{Name: "release", Description: "ship", ArgumentHint: "<tag>"}}, Skills: []resources.Skill{{Name: "review", Description: "inspect changes"}}})
	if len(got) != 2 || got[0].Name != "release" || got[0].Description != "<tag> — ship" || got[1].Name != "skill:review" {
		t.Fatalf("resource catalog = %#v", got)
	}
}
