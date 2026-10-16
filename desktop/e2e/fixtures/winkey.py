"""Press keys like a real keyboard on Windows (SendInput), and bring a window to the front, for the
desktop e2e tests on a Windows computer.

Usage: python winkey.py focus "Target app" down LControl down LWin sleep 4 up LWin up LControl front

  focus <title>   bring the window whose title contains <title> to the front
  down|up|tap <k> press, let go, or press and let go a key (LControl, RControl, LWin, LShift, Escape, …)
  sleep <s>       wait <s> seconds
  front           print the title of the window in front
"""
import ctypes
import sys
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)

INPUT_KEYBOARD = 1
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
ULONG_PTR = ctypes.c_size_t


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]


class _UNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _UNION)]


user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
user32.SendInput.restype = wintypes.UINT

VK = {
    "LControl": 0xA2, "RControl": 0xA3, "LWin": 0x5B, "RWin": 0x5C, "LShift": 0xA0, "RShift": 0xA1,
    "LMenu": 0xA4, "RMenu": 0xA5, "Escape": 0x1B, "F24": 0x87, "A": 0x41, "V": 0x56,
}
# Keys Windows sends with the "extended" flag.
EXTENDED = {0xA3, 0x5B, 0x5C, 0xA5}


def key(name, down):
    vk = VK[name]
    flags = (0 if down else KEYEVENTF_KEYUP) | (KEYEVENTF_EXTENDEDKEY if vk in EXTENDED else 0)
    inp = INPUT(type=INPUT_KEYBOARD, u=_UNION(ki=KEYBDINPUT(wVk=vk, wScan=user32.MapVirtualKeyW(vk, 0), dwFlags=flags, time=0, dwExtraInfo=0)))
    if user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT)) != 1:
        raise OSError(ctypes.get_last_error(), "SendInput failed")


def title_of(hwnd):
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def find(title):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _):
        if user32.IsWindowVisible(hwnd) and title in title_of(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(each, 0)
    return found[0] if found else None


def focus(title):
    hwnd = find(title)
    if not hwnd:
        sys.exit(f"no window titled {title!r}")
    # Windows lets a program bring a window to the front while a key it sent is down: hold Alt, and
    # tap F24 before letting go so the Alt doesn't open a menu.
    key("LMenu", True)
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    user32.BringWindowToTop(hwnd)
    key("F24", True)
    key("F24", False)
    key("LMenu", False)
    time.sleep(0.3)
    if user32.GetForegroundWindow() != hwnd:
        sys.exit(f"couldn't bring {title!r} to the front (it's {title_of(user32.GetForegroundWindow())!r})")


args = sys.argv[1:]
i = 0
while i < len(args):
    a = args[i]
    if a == "front":
        print(title_of(user32.GetForegroundWindow()), flush=True)
        i += 1
        continue
    b = args[i + 1]
    if a == "focus":
        focus(b)
    elif a == "down":
        key(b, True)
    elif a == "up":
        key(b, False)
    elif a == "tap":
        key(b, True)
        key(b, False)
    elif a == "sleep":
        time.sleep(float(b))
    else:
        sys.exit(f"unknown command {a}")
    i += 2
