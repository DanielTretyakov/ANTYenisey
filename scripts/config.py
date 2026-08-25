"""Path constants and configuration for the personal knowledge base."""

import os
import shutil
import sys
from pathlib import Path
from datetime import datetime, timezone

# ── Paths ──────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent.parent
DAILY_DIR = ROOT_DIR / "daily"
KNOWLEDGE_DIR = ROOT_DIR / "knowledge"
CONCEPTS_DIR = KNOWLEDGE_DIR / "concepts"
CONNECTIONS_DIR = KNOWLEDGE_DIR / "connections"
QA_DIR = KNOWLEDGE_DIR / "qa"
REPORTS_DIR = ROOT_DIR / "reports"
SCRIPTS_DIR = ROOT_DIR / "scripts"
HOOKS_DIR = ROOT_DIR / "hooks"
AGENTS_FILE = ROOT_DIR / "AGENTS.md"

INDEX_FILE = KNOWLEDGE_DIR / "index.md"
LOG_FILE = KNOWLEDGE_DIR / "log.md"
STATE_FILE = SCRIPTS_DIR / "state.json"

# ── Timezone ───────────────────────────────────────────────────────────
TIMEZONE = "America/Chicago"


def now_iso() -> str:
    """Current time in ISO 8601 format."""
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def today_iso() -> str:
    """Current date in ISO 8601 format."""
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")


# ── git-bash (Windows) ─────────────────────────────────────────────────
# Claude Code на Windows запускается только при наличии git-bash и ищет его
# через CLAUDE_CODE_GIT_BASH_PATH. Хук наследует окружение от процесса,
# который его породил, и если переменной там нет, Agent SDK падает с
# «exit code 1 / Check stderr output for details» — текстом, по которому
# причину не угадать. Поэтому определяем путь сами, до вызова SDK.

def find_git_bash() -> str | None:
    """Найти bash.exe от git-for-windows. None, если не нашли или не Windows."""
    if sys.platform != "win32":
        return None

    def usable(path: Path) -> bool:
        # System32\bash.exe — это launcher WSL, а не git-bash; он не подойдёт.
        return path.is_file() and "system32" not in str(path).lower()

    # 1. Уже заданный путь уважаем, но проверяем: переменная могла протухнуть.
    current = os.environ.get("CLAUDE_CODE_GIT_BASH_PATH")
    if current and usable(Path(current)):
        return current

    candidates: list[Path] = []

    # 2. От самого git. Подниматься на фиксированное число уровней нельзя:
    #    git лежит то в <root>/cmd/git.exe, то в <root>/mingw64/bin/git.exe,
    #    а bash — всегда в <root>/bin/bash.exe. Поэтому идём вверх по родителям.
    git_exe = shutil.which("git")
    if git_exe:
        for parent in Path(git_exe).resolve().parents:
            candidates.append(parent / "bin" / "bash.exe")

    # 3. Стандартные места установки — на случай, если git не в PATH.
    for env_var in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        base = os.environ.get(env_var)
        if base:
            candidates.append(Path(base) / "Git" / "bin" / "bash.exe")

    for candidate in candidates:
        if usable(candidate):
            return str(candidate)

    # 4. Последняя попытка: bash из PATH (у git-bash это <root>/usr/bin/bash.exe).
    bash_exe = shutil.which("bash")
    if bash_exe and usable(Path(bash_exe)):
        return bash_exe

    return None


def ensure_git_bash() -> str | None:
    """Выставить CLAUDE_CODE_GIT_BASH_PATH, если не задан. Вернуть найденный путь."""
    path = find_git_bash()
    if path:
        os.environ["CLAUDE_CODE_GIT_BASH_PATH"] = path
    return path


# ── Вывод в UTF-8 ──────────────────────────────────────────────────────
# Консоль Windows в русской локали — cp1251, и Python берёт её для stdout
# и для logging.FileHandler. Любой символ вне cp1251 (₽, эмодзи, длинное
# тире) роняет print с UnicodeEncodeError, а в логах молча теряет строку.
# Для проекта про рубли это не теоретическая проблема.

def force_utf8_io() -> None:
    """Перевести stdout/stderr в UTF-8. Безопасно вызывать повторно."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                # Поток уже закрыт или подменён — не повод падать.
                pass
