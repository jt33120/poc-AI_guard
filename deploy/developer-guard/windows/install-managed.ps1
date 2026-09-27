#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$VsixPath,
  [Parameter(Mandatory = $true)][string]$VsCodeInstallDirectory,
  [string]$AllowedExtensionsJson = '{"xsom.xsom-secret-guard-vscode":["0.6.0"],"*":false}'
)

$ErrorActionPreference = 'Stop'
$allowed = $AllowedExtensionsJson | ConvertFrom-Json -AsHashtable
if (-not $allowed.ContainsKey('xsom.xsom-secret-guard-vscode')) {
  throw 'AllowedExtensions must include xsom.xsom-secret-guard-vscode'
}
if (-not (Test-Path -LiteralPath $VsixPath -PathType Leaf)) { throw 'VSIX not found' }
if (-not (Test-Path -LiteralPath $VsCodeInstallDirectory -PathType Container)) {
  throw 'VS Code installation directory not found'
}

$policyKey = 'HKLM:\Software\Policies\Microsoft\VSCode'
New-Item -Path $policyKey -Force | Out-Null
New-ItemProperty -Path $policyKey -Name 'AllowedExtensions' -PropertyType String `
  -Value ($allowed | ConvertTo-Json -Compress) -Force | Out-Null
New-ItemProperty -Path $policyKey -Name 'ExtensionsAutoUpdate' -PropertyType String `
  -Value 'false' -Force | Out-Null
New-ItemProperty -Path $policyKey -Name 'ChatHooks' -PropertyType String `
  -Value 'true' -Force | Out-Null

$bootstrap = Join-Path $VsCodeInstallDirectory 'bootstrap\extensions'
New-Item -Path $bootstrap -ItemType Directory -Force | Out-Null
Copy-Item -LiteralPath $VsixPath -Destination (Join-Path $bootstrap 'xsom-secret-guard-vscode.vsix') -Force

$codex = Join-Path $env:ProgramData 'OpenAI\Codex'
New-Item -Path $codex -ItemType Directory -Force | Out-Null
$requirements = @'
allowed_approval_policies = ["on-request"]
allowed_sandbox_modes = ["read-only", "workspace-write"]

[rules]
prefix_rules = [
  { pattern = [{ any_of = ["powershell", "pwsh", "cmd"] }], decision = "prompt", justification = "Explicit approval for shell entry points" },
]
'@
Set-Content -LiteralPath (Join-Path $codex 'requirements.toml') -Value $requirements -Encoding utf8NoBOM
icacls $codex /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'Users:(OI)(CI)RX' | Out-Null

Write-Output 'Managed files installed. Restart VS Code and run Developer: Policy Diagnostics.'
