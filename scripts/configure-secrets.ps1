$ErrorActionPreference = "Stop"

$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) ".env.local"

function Read-SecretValue {
  param([Parameter(Mandatory = $true)][string]$Prompt)

  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Set-EnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Content,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $escapedName = [Regex]::Escape($Name)
  if ($Content -match "(?m)^${escapedName}=") {
    return [Regex]::Replace($Content, "(?m)^${escapedName}=.*$", "$Name=$Value")
  }

  return $Content.TrimEnd() + [Environment]::NewLine + "$Name=$Value" + [Environment]::NewLine
}

if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env.local does not exist: $envPath"
}

$openAiKey = Read-SecretValue "Paste OPENAI_API_KEY"
$supabaseKey = Read-SecretValue "Paste SUPABASE_SERVICE_ROLE_KEY"

if ([string]::IsNullOrWhiteSpace($openAiKey) -or [string]::IsNullOrWhiteSpace($supabaseKey)) {
  throw "Both secrets are required. No changes were written."
}

$content = [IO.File]::ReadAllText($envPath)
$content = Set-EnvValue -Content $content -Name "OPENAI_API_KEY" -Value $openAiKey
$content = Set-EnvValue -Content $content -Name "SUPABASE_SERVICE_ROLE_KEY" -Value $supabaseKey
[IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))

$openAiKey = $null
$supabaseKey = $null
Write-Host "Secrets saved to .env.local. You can close this window."
