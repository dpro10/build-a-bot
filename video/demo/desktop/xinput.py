"""Real input for the desktop scenes under Xvfb (XTest): the pointer glides like a hand moves a
mouse, clicks are real clicks, keys are real key presses.

Usage: python3 xinput.py glide X Y MS  move X Y  click  down  up  key-down NAME  key-up NAME  sleep S
Coordinates are screen pixels. Commands run in order.
"""
import ctypes
import math
import sys
import time

x11 = ctypes.cdll.LoadLibrary("libX11.so.6")
xtst = ctypes.cdll.LoadLibrary("libXtst.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
x11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong] + [ctypes.POINTER(ctypes.c_ulong)] * 2 + [ctypes.POINTER(ctypes.c_int)] * 4 + [ctypes.POINTER(ctypes.c_uint)]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
x11.XFlush.argtypes = [ctypes.c_void_p]

display = x11.XOpenDisplay(None)
if not display:
    sys.exit("no X display")


def where():
    root, child = ctypes.c_ulong(), ctypes.c_ulong()
    rx, ry, wx, wy = ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
    mask = ctypes.c_uint()
    x11.XQueryPointer(display, x11.XDefaultRootWindow(display), ctypes.byref(root), ctypes.byref(child), ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(mask))
    return rx.value, ry.value


def move(x, y):
    xtst.XTestFakeMotionEvent(display, -1, int(round(x)), int(round(y)), 0)
    x11.XFlush(display)


def glide(x1, y1, ms):
    x0, y0 = where()
    dist = math.hypot(x1 - x0, y1 - y0) or 1
    nx, ny = -(y1 - y0) / dist, (x1 - x0) / dist
    arc = min(60, dist * 0.06)
    steps = max(2, int(ms / 1000 * 60))
    t0 = time.monotonic()
    for i in range(1, steps + 1):
        t = i / steps
        e = 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2
        bow = math.sin(math.pi * t) * arc
        move(x0 + (x1 - x0) * e + nx * bow, y0 + (y1 - y0) * e + ny * bow)
        wait = t0 + t * ms / 1000 - time.monotonic()
        if wait > 0:
            time.sleep(wait)


def key(name, down):
    sym = x11.XStringToKeysym(name.encode())
    xtst.XTestFakeKeyEvent(display, x11.XKeysymToKeycode(display, sym), 1 if down else 0, 0)
    x11.XFlush(display)


def button(down):
    xtst.XTestFakeButtonEvent(display, 1, 1 if down else 0, 0)
    x11.XFlush(display)


args = sys.argv[1:]
i = 0
while i < len(args):
    op = args[i]
    i += 1
    if op == "glide":
        glide(float(args[i]), float(args[i + 1]), float(args[i + 2]))
        i += 3
    elif op == "move":
        move(float(args[i]), float(args[i + 1]))
        i += 2
    elif op == "click":
        button(True)
        time.sleep(0.08)
        button(False)
    elif op in ("down", "up"):
        button(op == "down")
    elif op in ("key-down", "key-up"):
        key(args[i], op == "key-down")
        i += 1
    elif op == "sleep":
        time.sleep(float(args[i]))
        i += 1
    time.sleep(0.01)
