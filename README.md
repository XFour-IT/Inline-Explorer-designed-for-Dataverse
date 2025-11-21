# Dataverse Component Inspector

A Visual Studio Code extension that annotates Dataverse solution XML files with inline component metadata. When you place the caret on a line that contains a Dataverse GUID, the extension queries your environment and renders a subtle note showing the component type and display name directly beside the GUID.

## Features

- Sign in to your Dataverse environment using Azure Identity (supports the VS Code Azure Account extension) or a custom device code app registration.
- Configure and reuse multiple Dataverse environments from the **Dataverse Environments** taskpane.
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

3. Run the **Dataverse: Login** command from the Command Palette and pick an environment. Use **Add new environment** to capture the URL (and optional tenant ID) so you can reconnect quickly next time. The **Dataverse Environments** taskpane in the Explorer view also lets you add, remove, and sign in to saved environments.
   - If you are already signed in through the VS Code Azure Account extension, the extension will reuse that session through the Visual Studio Code credential.
   - To enter a custom client ID and client secret for your own Entra ID app, enable the **Dataverse: Allow custom client credentials** setting. Secrets are stored securely in the VS Code Secret Store.

4. Open an XML file from an unpacked Dataverse solution and place the caret on a line that contains a GUID. After a brief lookup, a comment such as `// Entity - Account` appears to the right of the GUID.

## Notes

- Authentication is powered by `@azure/identity` and uses the Visual Studio Code credential when you are already signed in through the Azure Account extension. Providing a client ID switches to a device code credential for your custom app registration, and the optional client secret is handled through the VS Code Secret Store when enabled.
- Only a subset of component types has dedicated display name resolvers. Components that are not yet supported fall back to showing the component type code and `Unknown name`.
- Device code login prompts appear in VS Code information messages. Keep the message open until you finish signing in.

## Using your own Entra ID app

If you prefer not to use the default VS Code session, you can register your own public client app:

1. In the Azure portal, open **Microsoft Entra ID** → **App registrations** and select **New registration**.
2. Name the app (for example, `Dataverse Component Inspector`) and choose **Accounts in any organizational directory** unless you want to scope to a single tenant.
3. Set the platform type to **Mobile and desktop applications**, then add a redirect URI of `https://login.microsoftonline.com/common/oauth2/nativeclient`.
4. Save the app registration and copy the **Application (client) ID** and **Directory (tenant) ID**.
5. In VS Code, enable **Dataverse: Allow custom client credentials** in settings, then run **Dataverse: Login**, enter your Dataverse environment URL, and paste the client ID and tenant ID you captured. The extension will use these values with the device code flow. If you also provide a client secret, it will be stored securely in the VS Code Secret Store.

The app needs the `user_impersonation` delegated permission for your Dataverse API. Grant admin consent if your tenant requires it.
