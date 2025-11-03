# Dataverse Component Inspector

A Visual Studio Code extension that annotates Dataverse solution XML files with inline component metadata. When you place the caret on a line that contains a Dataverse GUID, the extension queries your environment and renders a subtle note showing the component type and display name directly beside the GUID.

## Features

- Sign in to your Dataverse environment using Azure AD device code flow.
- Detect Dataverse GUIDs within XML files from unpacked solutions.
- Display inline annotations in translucent text with the component type and display name for the GUID under the cursor.
- Caches previously resolved GUIDs to reduce repeat network calls.

## Getting started

1. Install dependencies and compile the extension:

   ```bash
   npm install
   npm run compile
   ```

2. Press `F5` in VS Code to launch an Extension Development Host.

3. Run the **Dataverse: Login** command from the Command Palette and follow the device code prompts. Provide your environment URL (for example, `https://contoso.crm.dynamics.com`). You can also supply custom client and tenant IDs when needed.

4. Open an XML file from an unpacked Dataverse solution and place the caret on a line that contains a GUID. After a brief lookup, a comment such as `// Entity - Account` appears to the right of the GUID.

## Notes

- The extension uses Microsoft Authentication Library (MSAL) with the public client ID `51f81489-12ee-4a9e-aaae-a2591f45987d`. You can override this with your own Azure AD app registration.
- Only a subset of component types has dedicated display name resolvers. Components that are not yet supported fall back to showing the component type code and `Unknown name`.
- Device code login prompts appear in VS Code information messages. Keep the message open until you finish signing in.

## License

MIT
