#!/usr/bin/env python3
"""
iStocks — Cover Slide Only (Standalone)
Includes a trading prompt example so judges instantly understand what iStocks does.
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
import os

BASE = "/Users/priyanshu/Desktop/Desktop/Github/istocks-p"

# ============= COLORS =============
BG       = RGBColor(0x0F, 0x11, 0x17)
CARD     = RGBColor(0x1A, 0x1D, 0x26)
BORDER   = RGBColor(0x2A, 0x2D, 0x36)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
G3       = RGBColor(0xD1, 0xD5, 0xDB)
G4       = RGBColor(0x9C, 0xA3, 0xAF)
G5       = RGBColor(0x6B, 0x72, 0x80)
EM       = RGBColor(0x34, 0xD3, 0x99)
EM5      = RGBColor(0x10, 0xB9, 0x81)
BLU      = RGBColor(0x3B, 0x82, 0xF6)
PUR      = RGBColor(0x8B, 0x5C, 0xF6)
GLD      = RGBColor(0xF5, 0x9E, 0x0B)
HULT     = RGBColor(0xE5, 0x1A, 0x2C)
UN       = RGBColor(0x00, 0x96, 0xD6)
DARK_G   = RGBColor(0x14, 0x17, 0x20)
PROMPT_BG = RGBColor(0x0D, 0x1F, 0x17)

FNT = "Calibri"

prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)

def bg(s):
    f = s.background.fill; f.solid(); f.fore_color.rgb = BG

def tx(s, l, t, w, h, text, sz=18, c=WHITE, b=False, a=PP_ALIGN.LEFT):
    bx = s.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = bx.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; p.text = text
    p.font.size = Pt(sz); p.font.color.rgb = c; p.font.bold = b; p.font.name = FNT; p.alignment = a
    return bx, tf

def pa(tf, text, sz=18, c=WHITE, b=False, a=PP_ALIGN.LEFT, sb=0, sa=6):
    p = tf.add_paragraph(); p.text = text
    p.font.size = Pt(sz); p.font.color.rgb = c; p.font.bold = b; p.font.name = FNT
    p.alignment = a; p.space_before = Pt(sb); p.space_after = Pt(sa)

def rc(s, l, t, w, h, fc, bc=None):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(l), Inches(t), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = fc
    if bc: sh.line.color.rgb = bc; sh.line.width = Pt(1)
    else: sh.line.fill.background()
    return sh

def cd(s, l, t, w, h, bc=BORDER):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(l), Inches(t), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = CARD; sh.line.color.rgb = bc; sh.line.width = Pt(1)
    return sh

def br(s, l, t, w, c=EM5):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(l), Inches(t), Inches(w), Inches(0.04))
    sh.fill.solid(); sh.fill.fore_color.rgb = c; sh.line.fill.background()

def bd(s, l, t, w, text, bgc=EM5, tc=WHITE, sz=12):
    rc(s, l, t, w, 0.38, bgc)
    tx(s, l, t+0.01, w, 0.36, text, sz=sz, c=tc, b=True, a=PP_ALIGN.CENTER)


# ==========================================
# SLIDE 1 — COVER (with trading example)
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)

# Top accent bar
br(s, 0, 0, 13.333)

# Navigation bar
rc(s, 0, 0.04, 13.333, 0.7, CARD, BORDER)
tx(s, 0.6, 0.12, 2, 0.5, "iStocks", sz=20, c=EM, b=True)
tx(s, 3.5, 0.18, 6, 0.35, "Stocks       Sangraha       AI Database       About", sz=12, c=G4)

# Hult Prize badges
bd(s, 1.5, 1.0, 3.0, "HULT PRIZE 2026  |  CAMPUS ROUND", HULT)
bd(s, 4.8, 1.0, 2.5, "Theme: UNLIMITED", UN)
bd(s, 7.6, 1.0, 3.8, "UN Sustainable Development Goals", RGBColor(0x1E, 0x40, 0x5D))

# Main title
tx(s, 1.0, 1.7, 11.3, 0.8, "iStocks: AI-Powered", sz=48, c=WHITE, b=True, a=PP_ALIGN.CENTER)
tx(s, 1.0, 2.4, 11.3, 0.8, "Prompt Algo Trading Platform", sz=48, c=EM, b=True, a=PP_ALIGN.CENTER)

# Subtitle
tx(s, 2, 3.2, 9, 0.4,
    "Trade like a pro — just type what you want in plain English or 40+ Indian languages",
    sz=17, c=G4, a=PP_ALIGN.CENTER)

# ========== TRADING PROMPT EXAMPLE ==========
# Dark card that looks like a terminal/chat prompt
rc(s, 2.5, 3.85, 8.3, 1.5, PROMPT_BG, EM5)

# Prompt label
tx(s, 2.8, 3.95, 2, 0.3, "Your Command:", sz=11, c=G5, b=True)

# The actual trading prompt — big and clear
tx(s, 2.8, 4.25, 7.7, 0.6,
    "\"Buy 100 Reliance stocks when RSI drops below 30\"",
    sz=22, c=EM, b=True, a=PP_ALIGN.LEFT)

# Arrow + Result
tx(s, 2.8, 4.85, 7.7, 0.35,
    "iStocks AI executes it automatically — no code, no complexity, just results.",
    sz=13, c=G3, a=PP_ALIGN.LEFT)

# ========== FEATURE PILLARS ==========
pillars = [
    ("AI Analysis", "Angle 1.0", EM5),
    ("Real-Time Data", "17+ Stocks Live", RGBColor(0x16, 0xA3, 0x4A)),
    ("NLP Chat", "40+ Languages", BLU),
    ("Algo Trading", "Prompt-Based", PUR),
]
for i, (t, sub, c) in enumerate(pillars):
    l = 1.8 + i * 2.6
    cd(s, l, 5.6, 2.3, 1.1, c)
    tx(s, l, 5.7, 2.3, 0.35, t, sz=14, c=WHITE, b=True, a=PP_ALIGN.CENTER)
    tx(s, l, 6.05, 2.3, 0.35, sub, sz=11, c=G4, a=PP_ALIGN.CENTER)

# Footer
tx(s, 2, 6.95, 9, 0.3, "Team iStocks   |   IIT Roorkee   |   istocks.codes", sz=13, c=G5, a=PP_ALIGN.CENTER)

# Bottom accent bar
br(s, 0, 7.44, 13.333)


# ============= SAVE =============
out = os.path.join(BASE, "iStocks_CoverSlide.pptx")
prs.save(out)
print(f"Saved: {out}")
print("Done! Copy this slide into your main PPT.")
