"""
Configurador de red interactivo para El peso de las razones.
Detecta IPs disponibles (Linux + Windows vía ipconfig.exe en WSL),
permite elegir cuál usar y actualiza el archivo .env con IP_OVERRIDE.
"""

import os
import re
import socket
import subprocess
import sys

ENV_FILE = os.path.join(os.path.dirname(__file__), ".env")
PORT = 5000

HEADER = "=" * 60

# ── Tipos de IP ──────────────────────────────────────────────

WSL_PREFIXES = ("172.",)
LOOPBACK_PREFIXES = ("127.",)


def _classify(name: str, ip: str) -> str:
    name_lower = name.lower()
    if ip.startswith(LOOPBACK_PREFIXES):
        return "Loopback"
    if "wsl" in name_lower or "hyper-v" in name_lower or ip.startswith(WSL_PREFIXES):
        return "WSL"
    if "wi-fi" in name_lower or "wireless" in name_lower or "wlan" in name_lower:
        return "Wi-Fi"
    if "hotspot" in name_lower or "móvil" in name_lower or "movil" in name_lower or "137." in ip:
        return "Hotspot"
    if "ethernet" in name_lower or "local" in name_lower:
        return "Ethernet"
    return "Red"


def _is_unsafe(kind: str) -> bool:
    return kind in ("WSL", "Loopback")


# ── Detección de IPs ─────────────────────────────────────────

def _linux_ips() -> list[dict]:
    """IPs de las interfaces de red Linux/WSL."""
    entries = []
    try:
        result = subprocess.run(
            ["ip", "addr"],
            capture_output=True, text=True
        )
        current_iface = None
        for line in result.stdout.splitlines():
            m = re.match(r"^\d+:\s+(\S+):", line)
            if m:
                current_iface = m.group(1)
            m = re.match(r"\s+inet\s+([\d.]+)/\d+", line)
            if m and current_iface:
                ip = m.group(1)
                label = f"Linux WSL (interfaz {current_iface})"
                entries.append({"name": label, "ip": ip, "source": "linux"})
    except Exception:
        # Fallback: socket
        try:
            hostname = socket.gethostname()
            ip = socket.gethostbyname(hostname)
            entries.append({"name": "Linux (socket)", "ip": ip, "source": "linux"})
        except Exception:
            pass
    return entries


def _windows_ips() -> tuple[list[dict], str | None]:
    """IPs de Windows llamando a ipconfig.exe desde WSL."""
    error = None
    entries = []
    try:
        result = subprocess.run(
            ["ipconfig.exe"],
            capture_output=True, text=True,
            encoding="cp850"
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip())

        current_adapter = None
        for line in result.stdout.splitlines():
            # Línea de nombre de adaptador: sin indentación, termina con ':'
            if re.match(r"^[^\s]", line) and line.strip().endswith(":"):
                current_adapter = line.strip().rstrip(":")
            # Línea de IPv4
            m = re.search(r"IPv4[^:]*:\s*([\d.]+)", line)
            if m and current_adapter:
                ip = m.group(1)
                entries.append({"name": current_adapter, "ip": ip, "source": "windows"})
    except FileNotFoundError:
        error = "ipconfig.exe no encontrado (¿no estás en WSL?)"
    except Exception as exc:
        error = str(exc)
    return entries, error


def collect_ips() -> tuple[list[dict], str | None]:
    linux = _linux_ips()
    windows, win_error = _windows_ips()

    # Mostrar IPs de Windows primero (son las útiles para celulares),
    # luego las de Linux.
    all_ips = windows + linux

    # Clasificar y deduplicar por IP
    seen = set()
    result = []
    for entry in all_ips:
        ip = entry["ip"]
        if ip in seen:
            continue
        seen.add(ip)
        kind = _classify(entry["name"], ip)
        entry["kind"] = kind
        result.append(entry)

    return result, win_error


# ── .env ────────────────────────────────────────────────────

def _read_env() -> list[str]:
    if not os.path.exists(ENV_FILE):
        return []
    with open(ENV_FILE, encoding="utf-8") as f:
        return f.readlines()


def update_env(ip: str) -> None:
    lines = _read_env()
    found = False
    new_lines = []
    for line in lines:
        if line.startswith("IP_OVERRIDE="):
            new_lines.append(f"IP_OVERRIDE={ip}\n")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"IP_OVERRIDE={ip}\n")

    try:
        with open(ENV_FILE, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
    except OSError as exc:
        print(f"\n⚠  No se pudo escribir {ENV_FILE}: {exc}")
        print(f"   Copiá esta línea manualmente al archivo .env:")
        print(f"   IP_OVERRIDE={ip}")
        raise


# ── UI ───────────────────────────────────────────────────────

def _kind_label(kind: str) -> str:
    labels = {
        "Wi-Fi":    "[Wi-Fi]",
        "Hotspot":  "[Hotspot]",
        "Ethernet": "[Ethernet]",
        "WSL":      "[WSL — no usar para presentación]",
        "Loopback": "[Loopback — no usar para presentación]",
        "Red":      "[Red]",
    }
    return labels.get(kind, f"[{kind}]")


def print_header() -> None:
    print()
    print(HEADER)
    print("  Configurador de red — El peso de las razones")
    print(HEADER)
    print()


def show_ips(ips: list[dict]) -> None:
    for i, entry in enumerate(ips, 1):
        label = _kind_label(entry["kind"])
        print(f"  [{i}] {entry['name']}")
        print(f"      IP: {entry['ip']:<18} {label}")
        print()


def ask_choice(ips: list[dict]) -> dict:
    while True:
        try:
            raw = input(f"¿Qué IP querés usar para que los celulares se conecten?\n"
                        f"Escribí el número de la opción [1-{len(ips)}]: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nCancelado.")
            sys.exit(0)

        if not raw.isdigit():
            print("  ⚠  Ingresá un número.\n")
            continue

        idx = int(raw) - 1
        if not (0 <= idx < len(ips)):
            print(f"  ⚠  Opción fuera de rango. Elegí entre 1 y {len(ips)}.\n")
            continue

        entry = ips[idx]

        if _is_unsafe(entry["kind"]):
            try:
                confirm = input(
                    f"\n  ⚠  Esta IP ({entry['ip']}) normalmente NO funciona para "
                    f"conectar celulares.\n"
                    f"  ¿Estás seguro? (s/N): "
                ).strip().lower()
            except (KeyboardInterrupt, EOFError):
                print("\nCancelado.")
                sys.exit(0)
            if confirm != "s":
                print()
                continue

        return entry


def print_summary(ip: str) -> None:
    url = f"http://{ip}:{PORT}/jugador"
    print()
    print(HEADER)
    print("✓ Configuración guardada")
    print(HEADER)
    print()
    print(f"  IP seleccionada : {ip}")
    print(f"  URL para celulares: {url}")
    print()
    print("SIGUIENTE PASO:")
    print("  1. Reiniciá app.py (Ctrl+C y volvé a correr python app.py)")
    print("  2. Verificá que el QR del proyector apunta a la URL correcta")
    print("  3. Probá desde un celular ANTES de empezar la presentación")
    print()
    print("Si los celulares no pueden conectarse, probá:")
    print("  - Plan B: activá hotspot del celular y corré este script de nuevo")
    print("  - Plan C: usá ngrok (ver README)")
    print(HEADER)
    print()


# ── Main ─────────────────────────────────────────────────────

def main() -> None:
    print_header()
    print("Detectando IPs disponibles...")
    print()

    ips, win_error = collect_ips()

    if win_error:
        print(f"  ⚠  No se pudo ejecutar ipconfig.exe: {win_error}")
        print("     Solo se muestran IPs de Linux (probablemente no sirvan en WSL).")
        print()

    if not ips:
        print("  ✗  No se detectó ninguna IP. Verificá tu conexión de red.")
        sys.exit(1)

    show_ips(ips)

    entry = ask_choice(ips)

    try:
        update_env(entry["ip"])
    except OSError:
        pass  # El error ya fue impreso en update_env

    print_summary(entry["ip"])


if __name__ == "__main__":
    main()
