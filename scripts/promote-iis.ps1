[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9]+$')][string] $RunId,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string] $ExpectedSha,
    [Parameter(Mandatory)][string] $DownloadRoot,
    [switch] $ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Protected promotion requires PowerShell 7.' }

function Invoke-CapturedProcess([string] $Executable, [string[]] $Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Process could not be started.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(300000)) {
            $process.Kill($true)
            throw 'Process timed out.'
        }
        $result = $stdout.GetAwaiter().GetResult()
        $stderr.GetAwaiter().GetResult() | Out-Null
        if ($process.ExitCode -ne 0) { throw 'Process failed.' }
        return $result
    } catch {
        throw 'A required process failed. Its potentially sensitive output was suppressed.'
    } finally { $process.Dispose() }
}

function Get-GitHubJson([string] $Path) {
    $json = Invoke-CapturedProcess $script:gh @('api', '--method', 'GET', $Path)
    try { return $json | ConvertFrom-Json -Depth 30 }
    catch { throw 'GitHub returned an invalid release verification response.' }
}

function Get-VerifiedRun {
    $repo = Get-GitHubJson "repos/$script:repository"
    if ($env:GITHUB_REF -cne "refs/heads/$($repo.default_branch)") { throw 'Manual promotion must run from the actual default branch.' }
    $run = Get-GitHubJson "repos/$script:repository/actions/runs/$RunId"
    $workflow = Get-GitHubJson "repos/$script:repository/actions/workflows/commerce-ci.yml"
    if ($run.status -ne 'completed' -or $run.conclusion -ne 'success' -or $run.event -ne 'push' -or
        $run.head_branch -cne $repo.default_branch -or $run.head_sha -cne $ExpectedSha -or
        $run.path.Split('@')[0] -cne '.github/workflows/commerce-ci.yml' -or $run.name -cne 'Commerce CI' -or
        $workflow.path -cne '.github/workflows/commerce-ci.yml' -or $workflow.id -ne $run.workflow_id -or $workflow.state -ne 'active' -or
        $run.repository.full_name -cne $script:repository -or $run.head_repository.full_name -cne $script:repository) {
        throw 'Promotion requires a successful default-branch push run of Commerce CI at exactly the expected revision.'
    }
    return $run
}

function Quote-WebDeployValue([string] $Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '[\x00-\x1f\x7f]') { throw 'A deployment setting is missing or invalid.' }
    if (-not $Value.Contains("'")) { return "'$Value'" }
    if (-not $Value.Contains('"')) { return '"' + $Value + '"' }
    throw 'A deployment setting cannot be represented safely for Web Deploy.'
}

function Get-DeploymentTarget([string] $Prefix) {
    $site = [Environment]::GetEnvironmentVariable("${Prefix}_WEBSITE_NAME")
    $server = [Environment]::GetEnvironmentVariable("${Prefix}_SERVER_COMPUTER_NAME")
    $username = [Environment]::GetEnvironmentVariable("${Prefix}_SERVER_USERNAME")
    $password = [Environment]::GetEnvironmentVariable("${Prefix}_SERVER_PASSWORD")
    if ($site -notmatch '^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}$') { throw 'An IIS site setting is missing or invalid.' }
    $uri = $null
    if (-not [Uri]::TryCreate($server, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') { throw 'Web Deploy requires a credential-free HTTPS server origin with trusted TLS.' }
    $endpoint = [UriBuilder]::new($uri)
    $endpoint.Path = '/MsDeploy.axd'
    $endpoint.Query = 'site=' + [Uri]::EscapeDataString($site)
    $settings = 'computerName=' + (Quote-WebDeployValue $endpoint.Uri.AbsoluteUri) +
        ',userName=' + (Quote-WebDeployValue $username) + ',password=' + (Quote-WebDeployValue $password) + ",authType='Basic'"
    return @{ Site = $site; Content = 'contentPath=' + (Quote-WebDeployValue $site) + ',' + $settings;
        Recycle = 'recycleApp=' + (Quote-WebDeployValue $site) + ',' + $settings }
}

function Invoke-WebDeploy([string[]] $Arguments) {
    # Never echo command arguments, stderr, stdout, or credential-bearing exceptions.
    Invoke-CapturedProcess $script:msdeploy $Arguments | Out-Null
}

$maintenanceAttempted = $false
$targetsReady = $false
try {
    foreach ($name in @('RELEASE_ACK_MIGRATIONS', 'RELEASE_ACK_MAINTENANCE', 'RELEASE_ACK_LICENSE_HOSTING', 'RELEASE_ACK_CREDENTIALS', 'RELEASE_ACK_SECURITY')) {
        if ([Environment]::GetEnvironmentVariable($name) -cne 'true') { throw 'Every operator release acknowledgment must be explicitly true.' }
    }
    $script:repository = $env:GITHUB_REPOSITORY
    if ($script:repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or [string]::IsNullOrWhiteSpace($env:GH_TOKEN)) { throw 'Read-only GitHub release verification is unavailable.' }
    $script:gh = (Get-Command gh -CommandType Application -ErrorAction Stop).Source
    $run = Get-VerifiedRun
    $jobs = Get-GitHubJson "repos/$script:repository/actions/runs/$RunId/attempts/$($run.run_attempt)/jobs?per_page=100"
    if ($jobs.total_count -gt 100) { throw 'The complete required-job result set could not be verified.' }
    foreach ($name in @('Linux Build, Test And Security', 'Windows Paired IIS Artifacts')) {
        $required = @($jobs.jobs | Where-Object { $_.name -ceq $name })
        if ($required.Count -ne 1 -or $required[0].status -ne 'completed' -or $required[0].conclusion -ne 'success') { throw 'Both Linux gates and Windows packaging must have actually passed, not been skipped.' }
    }
    $artifactName = "commerce-iis-$ExpectedSha-$($run.run_attempt)"
    $artifacts = Get-GitHubJson "repos/$script:repository/actions/runs/$RunId/artifacts?per_page=100"
    $candidates = @($artifacts.artifacts | Where-Object { $_.name -ceq $artifactName })
    if ($artifacts.total_count -gt 100 -or $candidates.Count -ne 1 -or $candidates[0].expired -or [DateTimeOffset]::Parse($candidates[0].expires_at) -le [DateTimeOffset]::UtcNow) { throw 'One unexpired paired release artifact from the current successful run attempt is required.' }
    $download = [IO.Path]::GetFullPath($DownloadRoot).TrimEnd('\', '/')
    $parent = Split-Path -Parent $download
    if (-not (Test-Path -LiteralPath $parent -PathType Container) -or (Test-Path -LiteralPath $download)) { throw 'The download parent must exist and the release destination must be new.' }
    New-Item -ItemType Directory -Path $download | Out-Null
    Invoke-CapturedProcess $script:gh @('run', 'download', $RunId, '--repo', $script:repository, '--name', $artifactName, '--dir', $download) | Out-Null
    & (Join-Path $PSScriptRoot 'package-iis.ps1') -VerifyOnly -Revision $ExpectedSha -OutputRoot $download
    $manifest = Get-Content -LiteralPath (Join-Path $download 'release-manifest.json') -Raw | ConvertFrom-Json -Depth 20
    if ($manifest.source.repository -cne $script:repository -or $manifest.source.runId -cne $RunId -or
        [string]$manifest.source.runAttempt -cne [string]$run.run_attempt -or $manifest.source.event -cne 'push' -or
        $manifest.source.workflow -cne '.github/workflows/commerce-ci.yml') { throw 'The paired manifest provenance does not match the passing source run.' }
    $security = Get-Content -LiteralPath (Join-Path $download 'security/audit-summary.json') -Raw | ConvertFrom-Json -Depth 20
    if ($security.fullVulnerabilityCount -ne 0) { throw 'Development advisories cannot be promoted by acknowledgment.' }
    $current = Get-VerifiedRun
    if ($current.run_attempt -ne $run.run_attempt) { throw 'The source run attempt changed during release verification.' }
    if ($ValidateOnly) {
        'Passing default-branch push, expected revision, paired provenance, all hashes, and operator inputs verified. No deployment was attempted.'
        return
    }
    $script:msdeploy = Join-Path ${env:ProgramFiles(x86)} 'IIS/Microsoft Web Deploy V3/msdeploy.exe'
    if (-not (Test-Path -LiteralPath $script:msdeploy -PathType Leaf)) { throw 'Web Deploy is not installed on the Windows runner.' }
    $backend = Get-DeploymentTarget 'BACK'
    $frontend = Get-DeploymentTarget 'FRONT'
    if ($backend.Site -ceq $frontend.Site -and $env:BACK_SERVER_COMPUTER_NAME -ceq $env:FRONT_SERVER_COMPUTER_NAME) { throw 'Backend and frontend must target distinct IIS applications.' }
    $targetsReady = $true
    # External maintenance remains active through post-rollout operator smoke checks.
    $maintenanceAttempted = $true
    Invoke-WebDeploy @('-verb:sync', '-source:recycleApp', "-dest:$($frontend.Recycle),recycleMode=StopAppPool")
    Invoke-WebDeploy @('-verb:sync', '-source:recycleApp', "-dest:$($backend.Recycle),recycleMode=StopAppPool")
    Invoke-WebDeploy @('-verb:sync', ('-source:contentPath=' + (Quote-WebDeployValue (Join-Path $download 'backend'))), "-dest:$($backend.Content)")
    Invoke-WebDeploy @('-verb:sync', ('-source:contentPath=' + (Quote-WebDeployValue (Join-Path $download 'frontend'))), "-dest:$($frontend.Content)")
    Invoke-WebDeploy @('-verb:sync', '-source:recycleApp', "-dest:$($backend.Recycle),recycleMode=StartAppPool")
    Invoke-WebDeploy @('-verb:sync', '-source:recycleApp', "-dest:$($frontend.Recycle),recycleMode=StartAppPool")
    'Both tested applications were synced before either was restarted. Keep external maintenance active until operator schema, catalog, cookie/auth, static-asset, and safe commerce smoke checks pass.'
} catch {
    if ($maintenanceAttempted -and $targetsReady) {
        foreach ($target in @($frontend, $backend)) {
            try { Invoke-WebDeploy @('-verb:sync', '-source:recycleApp', "-dest:$($target.Recycle),recycleMode=StopAppPool") }
            catch { }
        }
        throw 'Coordinated promotion failed. Pool stops were retried without exposing process output. Keep external maintenance active, verify both pool states, and have the operator restore the paired release/database. No automatic or atomic rollback was attempted.'
    }
    throw 'Promotion preflight failed. No deployment was attempted. Verify the passing default-branch CI run, exact revision, intact artifacts, all operator acknowledgments, trusted TLS, and protected deployment settings.'
}
