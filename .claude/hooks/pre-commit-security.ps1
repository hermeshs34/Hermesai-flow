# HermesAI Flow - Hook Pre-Commit Seguridad
#
# SOLO ASCII EN ESTE ARCHIVO. Esta guardado en UTF-8 sin BOM y Windows
# PowerShell 5.1 lo lee como ANSI: un guion largo se convierte en tres bytes,
# el ultimo de los cuales es una comilla tipografica que PowerShell toma como
# fin de cadena. El script dejaba de compilar y el hook no llegaba a ejecutar
# ni una comprobacion. Nada de acentos, guiones largos ni comillas curvas.

# El filtro "solo en git commit" se hace AQUI, no en la configuracion. El campo
# 'if' del hook no se pudo verificar nunca -en modo -p no se ejecuta ningun
# PreToolUse, ni pasando la config por --settings- y un filtro que no se puede
# probar es la forma de fallo que ya nos costo esta semana entera. El hook se
# declara sin filtro, salta en cada Bash/PowerShell y sale de inmediato si el
# comando no es un commit. Cuesta el arranque de powershell.exe por llamada.
#
# Claude Code envia el JSON de la llamada por stdin: .tool_input.command.
if ([Console]::IsInputRedirected) {
    $payload = [Console]::In.ReadToEnd()

    if (-not [string]::IsNullOrWhiteSpace($payload)) {
        # Si el JSON no se puede leer NO se sale en silencio: se sigue y se
        # comprueba el indice igualmente. Ante la duda, verificar de mas.
        $cmd = $null
        try { $cmd = (ConvertFrom-Json $payload).tool_input.command } catch { }

        if ($null -ne $cmd -and $cmd -notmatch '(^|[;&|]\s*)git\s+(-\S+\s+)*commit\b') {
            exit 0
        }
    }
}

# El cwd de la sesion NO es el repo: Claude Code se abre en la raiz del
# workspace, dos niveles por encima. Un 'git diff --cached' a secas devolvia
# vacio desde ahi y el hook contestaba OK sin haber mirado un solo archivo.
#
# El hook esta declarado en la configuracion de USUARIO, asi que puede saltar en
# cualquier repositorio. Por eso se busca primero el repo del directorio actual;
# solo si el cwd no esta dentro de ninguno -el caso de esta sesion- se cae a la
# ubicacion del propio script, que vive en <repo>/.claude/hooks/.
$repo = git rev-parse --show-toplevel 2>$null

if ([string]::IsNullOrWhiteSpace($repo)) {
    $repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
}

# Fallar ruidosamente. Un hook de seguridad que no encuentra el repo tiene que
# bloquear el commit, no dejarlo pasar con la lista vacia.
if (-not (Test-Path (Join-Path $repo '.git'))) {
    Write-Host "[HOOK ERROR] No hay repositorio git en: $repo"
    Write-Host "  El hook no puede verificar nada. Commit bloqueado."
    exit 1
}

$staged = git -C "$repo" diff --cached --name-only 2>$null

$issues = @()

foreach ($file in $staged) {
    if ([string]::IsNullOrWhiteSpace($file)) { continue }

    if ($file -match '\.(ts|tsx|js|jsx)$') {
        # Out-String: git show devuelve un array de lineas y -match sobre un
        # array filtra en vez de dar un booleano. Se compara el archivo entero.
        $content = git -C "$repo" show ":$file" 2>$null | Out-String

        if ($content -match 'RESEND_API_KEY\s*=\s*["\x27]re_') {
            $issues += "[CRITICO] $file - RESEND_API_KEY hardcodeada"
        }
        if ($content -match 'ANTHROPIC_API_KEY\s*=\s*["\x27]sk-ant') {
            $issues += "[CRITICO] $file - ANTHROPIC_API_KEY hardcodeada"
        }

        # Se busca la credencial en si, no el nombre de la variable. Antes esto
        # era -match 'service_role', y -match en PowerShell ignora mayusculas:
        # casaba con Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), que es
        # justo el patron correcto. Saltaba en todo commit que tocara una Edge
        # Function, asi que el aviso no significaba nada.
        # Formatos: JWT (eyJ...), clave secreta nueva (sb_secret_...), PAT (sbp_...).
        if ($content -match '["\x27](eyJ[A-Za-z0-9_\-]{20,}|sb_secret_[A-Za-z0-9_\-]{10,}|sbp_[a-f0-9]{40})') {
            $issues += "[CRITICO] $file - credencial hardcodeada (JWT / service_role / PAT)"
        }

        if ($content -match '\.from\(["\x27]\w+["\x27]\)(?!.*organization_id)' -and $content -notmatch 'profiles|organizations') {
            $issues += "[ADVERTENCIA] $file - query posiblemente sin filtro organization_id"
        }
    }

    if ($file -match '\.env$' -and $file -notmatch '\.example$') {
        $issues += "[CRITICO] $file - archivo .env sensible incluido en commit"
    }
}

if ($issues.Count -gt 0) {
    Write-Host "ALERTA SEGURIDAD PRE-COMMIT - HermesAI Flow:"
    $issues | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Host "[HOOK OK] Pre-commit seguridad: sin credenciales hardcodeadas, sin .env sensibles. Commit autorizado."
exit 0
