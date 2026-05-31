import { protocol } from "electron";

export function registerAppProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "cdn",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
    {
      scheme: "local-media",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}
