[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$KeystorePath,
    [string]$Alias = 'project-tracker',
    [string]$Repository = 'rosegmp/projecttracker',
    [string]$Environment = 'production'
)

$ErrorActionPreference = 'Stop'

function ConvertTo-PlainText {
    param([Security.SecureString]$SecureValue)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$repoRoot = (git rev-parse --show-toplevel).Trim()
if (-not $repoRoot) {
    throw 'Run this script from the Project Tracker repository.'
}

$fullKeystorePath = [IO.Path]::GetFullPath($KeystorePath)
$repoPrefix = [IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\'
if ($fullKeystorePath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The permanent release keystore must be stored outside the Git repository.'
}
if (Test-Path -LiteralPath $fullKeystorePath) {
    throw "Refusing to replace the existing keystore at $fullKeystorePath"
}

$parentDirectory = Split-Path -Parent $fullKeystorePath
if (-not (Test-Path -LiteralPath $parentDirectory -PathType Container)) {
    throw "Create the secure backup directory first: $parentDirectory"
}

gh auth status | Out-Null
$passwordValue = $null
$encodedKeystore = $null
try {
    $password = Read-Host 'Enter a strong signing password already saved in the company password manager' -AsSecureString
    $passwordConfirmation = Read-Host 'Enter the signing password again' -AsSecureString
    $passwordValue = ConvertTo-PlainText $password
    $confirmationValue = ConvertTo-PlainText $passwordConfirmation
    if ($passwordValue -cne $confirmationValue) {
        throw 'The signing passwords did not match.'
    }
    if ($passwordValue.Length -lt 16) {
        throw 'Use a signing password containing at least 16 characters.'
    }

    $env:PROJECT_TRACKER_SIGNING_PASSWORD = $passwordValue
    keytool -genkeypair -v `
        -storetype JKS `
        -keystore $fullKeystorePath `
        -alias $Alias `
        -keyalg RSA `
        -keysize 4096 `
        -validity 10000 `
        -dname 'CN=Destiny Project Hub, O=Destiny Homes, C=US' `
        -storepass:env PROJECT_TRACKER_SIGNING_PASSWORD `
        -keypass:env PROJECT_TRACKER_SIGNING_PASSWORD
    if ($LASTEXITCODE -ne 0) {
        throw 'keytool did not create the release keystore.'
    }

    keytool -list `
        -keystore $fullKeystorePath `
        -storepass:env PROJECT_TRACKER_SIGNING_PASSWORD `
        -alias $Alias | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'The generated release keystore could not be verified.'
    }

    $encodedKeystore = [Convert]::ToBase64String([IO.File]::ReadAllBytes($fullKeystorePath))
    $encodedKeystore | gh secret set ANDROID_RELEASE_KEYSTORE_BASE64 --repo $Repository --env $Environment
    $passwordValue | gh secret set ANDROID_RELEASE_STORE_PASSWORD --repo $Repository --env $Environment
    $Alias | gh secret set ANDROID_RELEASE_KEY_ALIAS --repo $Repository --env $Environment
    $passwordValue | gh secret set ANDROID_RELEASE_KEY_PASSWORD --repo $Repository --env $Environment

    Write-Output "Release signing is configured for $Repository in the $Environment environment."
    Write-Output "Permanent keystore backup: $fullKeystorePath"
    Write-Output 'Keep that file in at least two encrypted backup locations. GitHub Secrets cannot restore it.'
} finally {
    Remove-Item Env:PROJECT_TRACKER_SIGNING_PASSWORD -ErrorAction SilentlyContinue
    $passwordValue = $null
    $confirmationValue = $null
    $encodedKeystore = $null
}
