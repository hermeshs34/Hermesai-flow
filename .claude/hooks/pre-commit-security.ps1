# HermesAI Flow — Hook Pre-Commit Seguridad
$staged = git diff --cached --name-only 2>/dev/null

$issues = @()

foreach ($file in $staged) {
    if ($file -match '\.(ts|tsx|js|jsx)$') {
        $content = git show ":$file" 2>/dev/null
        if ($content -match 'RESEND_API_KEY\s*=\s*["\x27]re_') { $issues += "[CRITICO] $file — RESEND_API_KEY hardcodeada" }
        if ($content -match 'ANTHROPIC_API_KEY\s*=\s*["\x27]sk-ant') { $issues += "[CRITICO] $file — ANTHROPIC_API_KEY hardcodeada" }
        if ($content -match 'service_role') { $issues += "[ALERTA] $file — posible service_role key expuesta" }
        if ($content -match '\.from\(["\x27]\w+["\x27]\)(?!.*organization_id)' -and $content -notmatch 'profiles|organizations') {
            $issues += "[ADVERTENCIA] $file — query posiblemente sin filtro organization_id"
        }
    }
    if ($file -match '\.env$' -and $file -notmatch '\.example$') {
        $issues += "[CRITICO] $file — archivo .env sensible incluido en commit"
    }
}

if ($issues.Count -gt 0) {
    Write-Host "ALERTA SEGURIDAD PRE-COMMIT — HermesAI Flow:"
    $issues | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Host "[HOOK OK] Pre-commit seguridad: sin credenciales hardcodeadas, sin .env sensibles. Commit autorizado."
exit 0
