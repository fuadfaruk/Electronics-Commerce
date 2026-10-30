[CmdletBinding(DefaultParameterSetName = 'Package')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Package')][string] $BackendPublish,
    [Parameter(Mandatory, ParameterSetName = 'Package')][string] $FrontendRoot,
    [Parameter(Mandatory, ParameterSetName = 'Package')][string] $SecurityRoot,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string] $Revision,
    [Parameter(Mandatory)][string] $OutputRoot,
    [Parameter(ParameterSetName = 'Verify')][switch] $VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Directory([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw 'A required packaging directory is missing.' }
    if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Packaging refuses symbolic links or junctions.' }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Test-ExcludedPath([string] $RelativePath, [bool] $Directory) {
    $normalized = $RelativePath.Replace('\', '/')
    $parts = $normalized.Split('/')
    if ($parts | Where-Object { $_ -in @('.git', '.kilo', 'logs', 'keys', 'key-ring', 'data-protection-keys', 'dataprotection-keys', 'keyring', 'coverage', 'test-results', 'playwright-report') }) { return $true }
    if ($normalized -match '(^|/)\.next/cache(/|$)') { return $true }
    if ($Directory) { return $false }
    $name = $parts[-1]
    if ($name -match '^(\.env($|\.)|env($|\.)|.+\.env$)' -and $name -notmatch '\.example$') { return $true }
    if ($name -match '\.(pfx|p12|pem|key|cer|crt|log|pubxml|user|trx|db|sqlite|bak)$' -or
        $name -match '^key-.+\.xml$' -or $name -match '^(secrets?|credentials?)\.json$') { return $true }
    if ($name -match '^appsettings\..+\.json$' -and $name -notmatch '\.example\.json$') { return $true }
    return $false
}

function Get-ReleaseEntries([string] $Path) {
    foreach ($item in Get-ChildItem -LiteralPath $Path -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release verification refuses symbolic links or junctions.' }
        $item
        if ($item.PSIsContainer) { Get-ReleaseEntries $item.FullName }
    }
}

function Copy-ReleaseTree([string] $Source, [string] $Destination, [string] $Relative = '') {
    if (-not (Test-Path -LiteralPath $Destination -PathType Container)) { throw 'The packaging destination parent is missing.' }
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        $relativePath = if ($Relative) { "$Relative/$($item.Name)" } else { $item.Name }
        if (Test-ExcludedPath $relativePath $item.PSIsContainer) { continue }
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Packaging refuses symbolic links or junctions.' }
        $target = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) {
            if (-not (Test-Path -LiteralPath $Destination -PathType Container)) { throw 'The packaging destination parent is missing.' }
            New-Item -ItemType Directory -Path $target -Force | Out-Null
            Copy-ReleaseTree $item.FullName $target $relativePath
        } else {
            Copy-Item -LiteralPath $item.FullName -Destination $target -Force
        }
    }
}

function Read-ReleaseXml([string] $Path) {
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create($Path, $settings)
    try {
        $document = [Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
        return ,$document
    } finally { $reader.Dispose() }
}

function Assert-CheckoutPaused([string] $Path) {
    try {
        $settings = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
        $commerce = $settings.PSObject.Properties['Commerce']
        $checkout = if ($null -ne $commerce) { $commerce.Value.PSObject.Properties['CheckoutEnabled'] } else { $null }
        if ($null -eq $checkout -or $checkout.Value -isnot [bool] -or $checkout.Value) { throw 'Invalid checkout setting.' }
    } catch { throw 'Packaged API must explicitly set Commerce.CheckoutEnabled to the JSON boolean false.' }
}

function Assert-FrontendEnvironment([Xml.XmlElement] $Platform) {
    $requiredEnvironment = @{ PORT = '%HTTP_PLATFORM_PORT%'; HOSTNAME = '127.0.0.1'; NODE_ENV = 'production';
        STOREFRONT_MODE = 'live'; API_BASE_URL = '%API_BASE_URL%'; STOREFRONT_URL = '%STOREFRONT_URL%' }
    foreach ($name in $requiredEnvironment.Keys) {
        $variables = @($Platform.SelectNodes("environmentVariables/environmentVariable[@name='$name']"))
        if ($variables.Count -ne 1 -or $variables[0].GetAttribute('value') -cne $requiredEnvironment[$name]) { throw 'Frontend IIS runtime environment is incomplete or unsafe.' }
    }
    $guestOnly = @($Platform.SelectNodes("environmentVariables/environmentVariable[@name='STOREFRONT_GUEST_ONLY']"))
    if ($guestOnly.Count -gt 1) { throw 'Unexpected packaged frontend environment values.' }
    if ($guestOnly.Count -eq 1 -and $guestOnly[0].GetAttribute('value') -cnotin @('true', 'false')) { throw 'Packaged STOREFRONT_GUEST_ONLY must be the boolean string true or false.' }
    $allowedEnvironment = @($requiredEnvironment.Keys) + @('STOREFRONT_GUEST_ONLY')
    foreach ($variable in $Platform.SelectNodes('environmentVariables/environmentVariable')) {
        if ($variable.GetAttribute('name') -cnotin $allowedEnvironment) { throw 'Unexpected packaged frontend environment values.' }
    }
}

function Assert-ReleaseLayout([string] $Path) {
    foreach ($relative in @('backend/ElectroApi.Api.dll', 'backend/ElectroApi.Api.runtimeconfig.json', 'backend/ElectroApi.Api.deps.json', 'backend/web.config', 'backend/appsettings.json',
            'frontend/server.js', 'frontend/.next/BUILD_ID', 'frontend/web.config', 'security/audit-summary.json',
            'security/npm-audit-runtime.json', 'security/npm-audit-full.json', 'security/nuget-audit.json', 'security/dev-advisory-exceptions.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Path $relative) -PathType Leaf)) { throw "Release is missing required file: $relative" }
    }
    Assert-CheckoutPaused (Join-Path $Path 'backend/appsettings.json')
    foreach ($relative in @('frontend/.next/static', 'frontend/public')) {
        $directory = Join-Path $Path $relative
        if (-not (Test-Path -LiteralPath $directory -PathType Container) -or
            @(Get-ChildItem -LiteralPath $directory -Recurse -File -Force).Count -eq 0) { throw "Release assets are missing: $relative" }
    }
    if (@(Get-ChildItem -LiteralPath (Join-Path $Path 'frontend/.next/static') -Recurse -File -Filter '*.js').Count -eq 0) { throw 'Release has no frontend JavaScript static assets.' }
    if (@(Get-ChildItem -LiteralPath (Join-Path $Path 'frontend/public') -Directory).Count -eq 0) { throw 'Release must preserve nested public assets.' }
    $api = Read-ReleaseXml (Join-Path $Path 'backend/web.config')
    $aspnet = $api.SelectSingleNode('//system.webServer/aspNetCore')
    $handler = $api.SelectSingleNode('//system.webServer/handlers/add[@modules="AspNetCoreModuleV2"]')
    if (-not $aspnet -or -not $handler -or $aspnet.GetAttribute('processPath') -ne 'dotnet' -or
        $aspnet.GetAttribute('arguments') -ne '.\ElectroApi.Api.dll' -or $aspnet.GetAttribute('stdoutLogEnabled') -ne 'false') {
        throw 'API IIS configuration must use framework-dependent .NET and disabled stdout logging.'
    }
    $runtime = Get-Content -LiteralPath (Join-Path $Path 'backend/ElectroApi.Api.runtimeconfig.json') -Raw | ConvertFrom-Json
    if ($runtime.runtimeOptions.tfm -ne 'net10.0' -or
        @($runtime.runtimeOptions.frameworks | Where-Object { $_.name -eq 'Microsoft.AspNetCore.App' -and $_.version -match '^10\.' }).Count -ne 1) { throw 'API release must be framework-dependent .NET 10.' }
    $dependencies = Get-Content -LiteralPath (Join-Path $Path 'backend/ElectroApi.Api.deps.json') -Raw | ConvertFrom-Json
    if ($dependencies.runtimeTarget.name -notmatch '/win-x64$') { throw 'API release must have a Windows x64 dependency graph.' }
    $front = Read-ReleaseXml (Join-Path $Path 'frontend/web.config')
    $platform = $front.SelectSingleNode('//system.webServer/httpPlatform')
    $frontHandler = $front.SelectSingleNode('//system.webServer/handlers/add[@modules="httpPlatformHandler"]')
    if (-not $platform -or -not $frontHandler -or $platform.GetAttribute('processPath') -ne '%ProgramFiles%\nodejs\node.exe' -or
        $platform.GetAttribute('arguments') -ne '.\server.js' -or $platform.GetAttribute('stdoutLogEnabled') -ne 'false') {
        throw 'Frontend IIS configuration must use Node HttpPlatformHandler and disabled stdout logging.'
    }
    Assert-FrontendEnvironment $platform
    $configuration = Join-Path $Path 'backend/appsettings.json'
    if (Test-Path -LiteralPath $configuration -PathType Leaf) {
        $settings = Get-Content -LiteralPath $configuration -Raw | ConvertFrom-Json
        foreach ($value in @($settings.AllowedHosts, $settings.ConnectionStrings.DefaultConnection, $settings.Storefront.Origin,
                $settings.Security.KeyPath, $settings.Security.KeyCertificateThumbprint, $settings.Mail.Host,
                $settings.Mail.Sender, $settings.Mail.Username, $settings.Mail.Password)) {
            if (-not [string]::IsNullOrWhiteSpace($value)) { throw 'Packaged API settings contain environment-specific values.' }
        }
        if (@($settings.Security.TrustedProxies).Count -ne 0) { throw 'Packaged API settings contain environment-specific proxies.' }
    }
    foreach ($native in Get-ChildItem -LiteralPath (Join-Path $Path 'frontend') -Recurse -File -Filter '*.node') {
        $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($native.FullName))
        try {
            if ($reader.ReadUInt16() -ne 0x5a4d) { throw 'A frontend native dependency is not a Windows binary.' }
            $reader.BaseStream.Position = 0x3c
            $offset = $reader.ReadUInt32()
            $reader.BaseStream.Position = $offset
            if ($reader.ReadUInt32() -ne 0x00004550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'A frontend native dependency is not Windows x64.' }
        } finally { $reader.Dispose() }
    }
    $security = Get-Content -LiteralPath (Join-Path $Path 'security/audit-summary.json') -Raw | ConvertFrom-Json
    if ($security.schemaVersion -ne 1 -or $security.policy -ne 'strict-zero-advisories' -or $security.status -ne 'passed' -or $security.revision -ne $Revision -or
        $security.runtimeVulnerabilityCount -ne 0 -or $security.fullVulnerabilityCount -ne 0 -or $security.nugetVulnerabilityCount -ne 0) { throw 'Release requires zero-advisory security evidence from this revision.' }
}

$output = [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\', '/')
if (-not $VerifyOnly) {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or [IntPtr]::Size -ne 8) { throw 'Build IIS release artifacts on Windows x64, not a Linux checkout.' }
    $backend = Assert-Directory $BackendPublish
    $frontend = Assert-Directory $FrontendRoot
    $security = Assert-Directory $SecurityRoot
    & node (Join-Path $PSScriptRoot 'verify-audit-evidence.mjs') $security $Revision
    if ($LASTEXITCODE -ne 0) { throw 'Release requires zero-advisory security evidence; no package was assembled.' }
    Assert-CheckoutPaused (Join-Path $backend 'appsettings.json')
    $standalone = Assert-Directory (Join-Path $frontend '.next/standalone')
    $static = Assert-Directory (Join-Path $frontend '.next/static')
    $public = Assert-Directory (Join-Path $frontend 'public')
    if (-not (Test-Path -LiteralPath (Join-Path $standalone 'server.js') -PathType Leaf)) { throw 'Next standalone output must contain server.js at its root.' }
    if (-not (Test-Path -LiteralPath (Join-Path $frontend 'iis/web.config') -PathType Leaf)) { throw 'The checked-in frontend IIS configuration is required.' }
    $parent = Split-Path -Parent $output
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'The release output parent must already exist.' }
    if (Test-Path -LiteralPath $output) { throw 'Release output already exists. Use a new directory; existing files are never removed.' }
    foreach ($source in @($backend, $frontend, $security)) {
        if ($output.StartsWith($source + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            $source.StartsWith($output + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $source -eq $output) { throw 'Release output may not overlap a source directory.' }
    }
    New-Item -ItemType Directory -Path $output | Out-Null
    foreach ($name in @('backend', 'frontend', 'security')) {
        if (-not (Test-Path -LiteralPath $output -PathType Container)) { throw 'The release output parent is missing.' }
        New-Item -ItemType Directory -Path (Join-Path $output $name) | Out-Null
    }
    Copy-ReleaseTree $backend (Join-Path $output 'backend')
    Copy-ReleaseTree $standalone (Join-Path $output 'frontend')
    $next = Join-Path $output 'frontend/.next'
    if (-not (Test-Path -LiteralPath (Split-Path -Parent $next) -PathType Container)) { throw 'The frontend output parent is missing.' }
    New-Item -ItemType Directory -Path $next -Force | Out-Null
    foreach ($assetSource in @($static, $public)) {
        $destination = if ($assetSource -eq $static) { Join-Path $next 'static' } else { Join-Path $output 'frontend/public' }
        if (-not (Test-Path -LiteralPath (Split-Path -Parent $destination) -PathType Container)) { throw 'The asset output parent is missing.' }
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        Copy-ReleaseTree $assetSource $destination
        foreach ($asset in Get-ChildItem -LiteralPath $assetSource -Recurse -File -Force) {
            $relative = $asset.FullName.Substring($assetSource.Length).TrimStart('\', '/')
            if (Test-ExcludedPath $relative $false) { continue }
            $copied = Join-Path $destination $relative
            if (-not (Test-Path -LiteralPath $copied -PathType Leaf) -or
                (Get-FileHash -LiteralPath $asset.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $copied -Algorithm SHA256).Hash) { throw 'A nested static or public asset was not copied intact.' }
        }
    }
    Copy-Item -LiteralPath (Join-Path $frontend 'iis/web.config') -Destination (Join-Path $output 'frontend/web.config') -Force
    foreach ($name in @('audit-summary.json', 'npm-audit-runtime.json', 'npm-audit-full.json', 'nuget-audit.json', 'dev-advisory-exceptions.json')) {
        Copy-Item -LiteralPath (Join-Path $security $name) -Destination (Join-Path $output "security/$name")
    }
    Assert-ReleaseLayout $output
    $files = @(foreach ($file in Get-ChildItem -LiteralPath $output -Recurse -File -Force | Sort-Object FullName) {
        $relative = $file.FullName.Substring($output.Length).TrimStart('\', '/').Replace('\', '/')
        [ordered]@{ path = $relative; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $file.Length }
    })
    $manifest = [ordered]@{
        schemaVersion = 1; revision = $Revision
        source = [ordered]@{ repository = $env:GITHUB_REPOSITORY; runId = $env:GITHUB_RUN_ID; runAttempt = $env:GITHUB_RUN_ATTEMPT;
            event = $env:GITHUB_EVENT_NAME; workflow = '.github/workflows/commerce-ci.yml' }
        target = [ordered]@{ os = 'windows'; architecture = 'x64'; runtime = 'win-x64'; node = '24.17.0'; dotnetSdk = '10.0.401'; ef = '10.0.13'; selfContained = $false }
        paired = @('backend', 'frontend'); requiresProductionConfiguration = $true; deploymentApprovalGranted = $false
        files = $files
    }
    $manifestPath = Join-Path $output 'release-manifest.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 12) + "`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $output 'release-manifest.sha256'), (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() + "`n", [Text.UTF8Encoding]::new($false))
}

$output = Assert-Directory $output
& node (Join-Path $PSScriptRoot 'verify-audit-evidence.mjs') (Join-Path $output 'security') $Revision
if ($LASTEXITCODE -ne 0) { throw 'Release security evidence is invalid or contains advisories.' }
$allEntries = @(Get-ReleaseEntries $output)
$manifestPath = Join-Path $output 'release-manifest.json'
$hashPath = Join-Path $output 'release-manifest.sha256'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $hashPath -PathType Leaf)) { throw 'The paired release manifest and checksum are required.' }
if ((Get-Content -LiteralPath $hashPath -Raw).Trim() -cne (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'The release manifest checksum does not match.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.revision -cne $Revision -or
    $manifest.target.os -ne 'windows' -or $manifest.target.architecture -ne 'x64' -or $manifest.target.runtime -ne 'win-x64' -or
    $manifest.target.node -ne '24.17.0' -or $manifest.target.dotnetSdk -ne '10.0.401' -or $manifest.target.ef -ne '10.0.13' -or
    $manifest.target.selfContained -ne $false -or ($manifest.paired -join ',') -ne 'backend,frontend' -or
    $manifest.requiresProductionConfiguration -ne $true -or $manifest.deploymentApprovalGranted -ne $false) { throw 'The manifest does not identify the required paired Windows release.' }
$seen = @{}
foreach ($entry in $manifest.files) {
    if ($entry.path -notmatch '^(backend|frontend|security)/' -or $entry.path -match '(\\|:|(^|/)\.{1,2}(/|$))' -or
        $entry.sha256 -notmatch '^[a-f0-9]{64}$' -or (Test-ExcludedPath $entry.path $false) -or $seen.ContainsKey($entry.path.ToLowerInvariant())) { throw 'The manifest contains an unsafe or duplicate file entry.' }
    $seen[$entry.path.ToLowerInvariant()] = $true
    $matches = @($allEntries | Where-Object { -not $_.PSIsContainer -and $_.FullName.Substring($output.Length).TrimStart('\', '/').Replace('\', '/') -ceq $entry.path })
    if ($matches.Count -ne 1) { throw 'Manifest file spelling does not match the packaged filesystem.' }
    $path = Join-Path $output $entry.path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -ne $entry.bytes -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) { throw 'A paired release file is missing or its checksum changed.' }
}
$actualFiles = @($allEntries | Where-Object { -not $_.PSIsContainer })
if ($actualFiles.Count -ne @($manifest.files).Count + 2) { throw 'The release contains files not recorded in its manifest.' }
foreach ($item in $allEntries) {
    $relative = $item.FullName.Substring($output.Length).TrimStart('\', '/').Replace('\', '/')
    if (Test-ExcludedPath $relative $item.PSIsContainer) { throw 'The release includes private environment, key, log, or test output.' }
}
Assert-ReleaseLayout $output
'Paired IIS release structure, nested assets, configuration, and SHA-256 checks passed. No IIS site was started or deployed.'
