"""Press keys like a real keyboard (XTest), for the voice typing e2e test under Xvfb.

Usage: python3 xkey.py down Control_R sleep 1.5 up Control_R tap Escape tap ctrl+v
"""
import ctypes
import sys
import time

x11 = ctypes.cdll.LoadLibrary("libX11.so.6")
xtst = ctypes.cdll.LoadLibrary("libXtst.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
x11.XFlush.argtypes = [ctypes.c_void_p]

display = x11.XOpenDisplay(None)
if not display:
    sys.exit("no X display")

ALIAS = {"ctrl": "Control_L", "shift": "Shift_L", "alt": "Alt_L", "super": "Super_L"}


def key(name, down):
    sym = x11.XStringToKeysym(ALIAS.get(name, name).encode())
    xtst.XTestFakeKeyEvent(display, x11.XKeysymToKeycode(display, sym), 1 if down else 0, 0)
    x11.XFlush(display)


args = sys.argv[1:]
i = 0
while i < len(args):
    op = args[i]
    i += 1
    if op == "sleep":
        time.sleep(float(args[i]))
        i += 1
    elif op in ("down", "up"):
        key(args[i], op == "down")
        i += 1
    elif op == "tap":
        keys = args[i].split("+")
        i += 1
        for k in keys:
            key(k, True)
        for k in reversed(keys):
            key(k, False)
    time.sleep(0.02)
