// Tests must never inherit the identity of a developer's real Herdr-managed pane.
process.env.HERDR_ENV = "0";
delete process.env.HERDR_SOCKET_PATH;
delete process.env.HERDR_PANE_ID;
