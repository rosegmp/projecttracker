# Private Android releases

Project Tracker publishes privately distributed Android releases from the manual **Publish private Android release** GitHub Actions workflow. The workflow runs only from protected `main`, uses the protected `production` environment, builds a release-signed APK, verifies the signature and bundled Supabase client configuration without printing values, uploads a retained workflow artifact, and creates a permanent release in the private GitHub repository.

## One-time signing activation

Use the existing production signing key if any prior production APK was distributed. Android will not install an update signed by a different key.

If no production key exists, use the repository setup script. It generates the key outside the repository, prompts securely for a password, verifies the key, and writes the four values directly into GitHub's protected `production` environment without printing them:

```powershell
.\scripts\setup-android-release-signing.ps1 -KeystorePath 'C:\secure-backups\project-tracker-release.jks'
```

Create the parent directory first. Store the password in the company password manager before entering it, then copy the resulting keystore to at least two encrypted backup locations. Do not place the keystore or passwords in this repository. GitHub Secrets are build inputs, not a recoverable backup.

Configure these secrets in the repository's protected `production` environment:

- `ANDROID_RELEASE_KEYSTORE_BASE64`: the complete keystore encoded as one Base64 string;
- `ANDROID_RELEASE_STORE_PASSWORD`: the keystore password;
- `ANDROID_RELEASE_KEY_ALIAS`: the signing-key alias;
- `ANDROID_RELEASE_KEY_PASSWORD`: the signing-key password.

The existing `GOOGLE_SERVICES_JSON`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_KEY` repository secrets are also required.

For an existing production key, PowerShell can encode it without printing it:

```powershell
$encodedKeystore = [Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secure\project-tracker-release.jks'))
$encodedKeystore | gh secret set ANDROID_RELEASE_KEYSTORE_BASE64 --repo rosegmp/projecttracker --env production
Remove-Variable encodedKeystore
```

Set each text secret interactively with `gh secret set NAME --repo rosegmp/projecttracker --env production` so it is read from standard input rather than included in command history.

## Publishing

1. Increase `versionCode` and `versionName` in `android/app/build.gradle`. Never reuse a published version code or release tag.
2. Merge the version change through the protected pull-request flow and wait for the complete main CI gate.
3. Run **Publish private Android release** on `main`.
4. Download the APK and checksum from the private GitHub release named `android-v<versionName>`.
5. Confirm the checksum, then test installation or upgrade, sign-in, push notifications, task links, file actions, and offline synchronization on the release tablet.

The first release-signed APK will not install over a debug-signed build with the same package id. Back up or sync device-local work, uninstall the debug build once, and install the release APK. Later private releases signed with the same preserved key will upgrade in place when their `versionCode` increases.
