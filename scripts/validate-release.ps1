Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
foreach ($name in @('package-iis.ps1', 'promote-iis.ps1')) {
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) { throw 'Release script syntax validation failed.' }
}
'Release PowerShell syntax validation passed.'
