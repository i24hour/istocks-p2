#!/usr/bin/env python3
"""
iStocks — Hult Prize 2026 Pitch Deck (10 Slides)
Theme: UNLIMITED | UN SDGs
Style: Clean, professional, formal. No emojis.
Financial data sourced from istocks_P&L_Structure (1).xlsx
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
CARD_ALT = RGBColor(0x13, 0x16, 0x1E)
BORDER   = RGBColor(0x2A, 0x2D, 0x36)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
G2       = RGBColor(0xE5, 0xE7, 0xEB)
G3       = RGBColor(0xD1, 0xD5, 0xDB)
G4       = RGBColor(0x9C, 0xA3, 0xAF)
G5       = RGBColor(0x6B, 0x72, 0x80)
EM       = RGBColor(0x34, 0xD3, 0x99)
EM5      = RGBColor(0x10, 0xB9, 0x81)
BLU      = RGBColor(0x3B, 0x82, 0xF6)
PUR      = RGBColor(0x8B, 0x5C, 0xF6)
RED      = RGBColor(0xEF, 0x44, 0x44)
RL       = RGBColor(0xF8, 0x71, 0x71)
GLD      = RGBColor(0xF5, 0x9E, 0x0B)
HULT     = RGBColor(0xE5, 0x1A, 0x2C)
UN       = RGBColor(0x00, 0x96, 0xD6)

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

def cd(s, l, t, w, h, bc=BORDER):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(l), Inches(t), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = CARD; sh.line.color.rgb = bc; sh.line.width = Pt(1)
    return sh

def rc(s, l, t, w, h, fc, bc=None):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(l), Inches(t), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = fc
    if bc: sh.line.color.rgb = bc; sh.line.width = Pt(1)
    else: sh.line.fill.background()
    return sh

def br(s, l, t, w, c=EM5):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(l), Inches(t), Inches(w), Inches(0.04))
    sh.fill.solid(); sh.fill.fore_color.rgb = c; sh.line.fill.background()

def ci(s, l, t, sz, fc):
    sh = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(l), Inches(t), Inches(sz), Inches(sz))
    sh.fill.solid(); sh.fill.fore_color.rgb = fc; sh.line.fill.background()

def bd(s, l, t, w, text, bgc=EM5, tc=WHITE, sz=12):
    rc(s, l, t, w, 0.38, bgc)
    tx(s, l, t+0.01, w, 0.36, text, sz=sz, c=tc, b=True, a=PP_ALIGN.CENTER)

def hd(s, label, lc, title):
    br(s, 0, 0, 13.333)
    tx(s, 0.8, 0.4, 5, 0.35, label, sz=12, c=lc, b=True)
    tx(s, 0.8, 0.82, 11.5, 0.85, title, sz=36, c=WHITE, b=True)


# ==========================================
# SLIDE 1 — COVER
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
br(s, 0, 0, 13.333)
rc(s, 0, 0.04, 13.333, 0.7, CARD, BORDER)
tx(s, 0.6, 0.12, 2, 0.5, "iStocks", sz=20, c=EM, b=True)
tx(s, 3.5, 0.18, 6, 0.35, "Stocks       Sangraha       AI Database       About", sz=12, c=G4)
bd(s, 1.5, 1.2, 3.0, "HULT PRIZE 2026  |  CAMPUS ROUND", HULT)
bd(s, 4.8, 1.2, 2.5, "Theme: UNLIMITED", UN)
bd(s, 7.6, 1.2, 3.8, "UN Sustainable Development Goals", RGBColor(0x1E, 0x40, 0x5D))
tx(s, 1.0, 2.3, 11.3, 0.9, "iStocks: AI-Powered", sz=50, c=WHITE, b=True, a=PP_ALIGN.CENTER)
tx(s, 1.0, 3.1, 11.3, 0.9, "Prompt Algo Trading Platform", sz=50, c=EM, b=True, a=PP_ALIGN.CENTER)
tx(s, 2, 4.1, 9, 0.5,
    "NLP-based trading in English and 40+ Indian regional languages",
    sz=19, c=G4, a=PP_ALIGN.CENTER)
pillars = [
    ("AI Analysis", "Angle 1.0", EM5),
    ("Real-Time Data", "17+ Stocks Live", RGBColor(0x16, 0xA3, 0x4A)),
    ("NLP Chat", "40+ Languages", BLU),
    ("Algo Trading", "Prompt-Based", PUR),
]
for i, (t, sub, c) in enumerate(pillars):
    l = 1.8 + i * 2.6
    cd(s, l, 5.0, 2.3, 1.2, c)
    tx(s, l, 5.1, 2.3, 0.4, t, sz=14, c=WHITE, b=True, a=PP_ALIGN.CENTER)
    tx(s, l, 5.5, 2.3, 0.4, sub, sz=11, c=G4, a=PP_ALIGN.CENTER)
tx(s, 2, 6.7, 9, 0.35, "Team iStocks   |   IIT Roorkee   |   istocks.codes", sz=13, c=G5, a=PP_ALIGN.CENTER)
br(s, 0, 7.44, 13.333)


# ==========================================
# SLIDE 2 — PROBLEM + OPPORTUNITY (combined)
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
hd(s, "THE PROBLEM", RL, "90% of Indian Traders Are Losing Money")

tx(s, 0.8, 1.7, 11, 0.4,
    "According to SEBI, over 90% of Indian traders lose money because they cannot access algorithmic trading. The reason: they cannot write code.",
    sz=15, c=G4)

stats = [
    ("30M+", "Retail traders\n21% YoY growth", RL),
    ("90%+", "In net loss\nSEBI Report 2024", RED),
    ("$11B+", "Daily trading\nvolume in India", GLD),
    ("< 3%", "Have access to\nalgo trading tools", PUR),
]
for i, (n, d, c) in enumerate(stats):
    l = 0.8 + i * 3.1
    cd(s, l, 2.4, 2.8, 1.9, BORDER)
    tx(s, l, 2.5, 2.8, 0.7, n, sz=36, c=c, b=True, a=PP_ALIGN.CENTER)
    tx(s, l, 3.2, 2.8, 0.8, d, sz=13, c=G4, a=PP_ALIGN.CENTER)

# Opportunity row
tx(s, 0.8, 4.6, 11, 0.35, "THE OPPORTUNITY", sz=12, c=GLD, b=True)

opps = [
    ("13Cr to 50Cr Demat accounts by 2030", EM),
    ("73% of Gen Z want to invest but lack knowledge", BLU),
    ("$7B+ daily volume from retail and semi-pro", GLD),
    ("800M+ smartphones — fintech-ready population", PUR),
]
for i, (text, c) in enumerate(opps):
    row = i // 2
    col = i % 2
    l = 0.8 + col * 6.2
    t = 5.05 + row * 0.55
    cd(s, l, t, 5.9, 0.45, BORDER)
    tx(s, l + 0.2, t + 0.04, 5.5, 0.37, text, sz=13, c=c, a=PP_ALIGN.LEFT)


# ==========================================
# SLIDE 3 — SOLUTION + HOW IT WORKS (combined)
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
hd(s, "OUR SOLUTION", EM, "iStocks: NLP-Based Algo Trading — No Code Required")

tx(s, 0.8, 1.7, 11, 0.4,
    "An NLP-based platform that works in English and 40+ Indian regional languages. Set your strategy and let AI execute.",
    sz=15, c=G4)

features = [
    ("AI Stock Analysis", "Angle 1.0 analyzes RSI, MACD,\nSMA, Bollinger Bands — explains\nin 40+ Indian languages.", EM),
    ("NLP Database Chat", "\"Compare RELIANCE with TCS\"\ngets instant, data-driven\nanalysis — in your language.", BLU),
    ("Prompt Algo Trading", "\"Buy 100 RELIANCE when RSI\ndrops below 30\" — multi-agent\nAI executes with risk mgmt.", PUR),
    ("Set and Forget", "Daily job workers set strategies\nonce — AI executes automatically.\nGet notified on your phone.", GLD),
]
for i, (t, d, c) in enumerate(features):
    l = 0.8 + i * 3.1
    cd(s, l, 2.3, 2.8, 2.8, BORDER)
    tx(s, l, 2.5, 2.8, 0.4, t, sz=15, c=c, b=True, a=PP_ALIGN.CENTER)
    br(s, l+0.6, 2.95, 1.6, c)
    tx(s, l+0.15, 3.1, 2.5, 1.5, d, sz=12, c=G4, a=PP_ALIGN.CENTER)

# Multi-agent flow
tx(s, 0.8, 5.35, 11, 0.35, "MULTI-AGENT ARCHITECTURE", sz=12, c=BLU, b=True)

steps = [
    ("Natural Language\nPrompt", EM),
    ("Trading Analysis\nAgent", BLU),
    ("Watching\nAgent", PUR),
    ("Automated\nExecution", GLD),
]
for i, (t, c) in enumerate(steps):
    l = 0.8 + i * 3.1
    cd(s, l, 5.8, 2.8, 1.0, c)
    tx(s, l, 5.9, 2.8, 0.8, t, sz=12, c=WHITE, b=True, a=PP_ALIGN.CENTER)
    if i < 3:
        tx(s, l+2.6, 6.0, 0.5, 0.5, ">", sz=18, c=G5, b=True, a=PP_ALIGN.CENTER)


# ==========================================
# SLIDE 4 — LIVE PRODUCT (screenshots)
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
hd(s, "LIVE PRODUCT", EM, "Not a Prototype — A Deployed, Working Platform")
tx(s, 0.8, 1.7, 11, 0.4, "Live at istocks.codes — open it right now to verify.", sz=15, c=EM)

screens = [
    ("Stock Dashboard", "Dashboard.png", EM5),
    ("AI Stock Analysis", "Stock_analysis.png", BLU),
    ("AI Database Chat", "Database_analysis.png", PUR),
]
for i, (t, f, c) in enumerate(screens):
    l = 0.5 + i * 4.2
    cd(s, l, 2.2, 4.0, 4.0, c)
    try:
        p = os.path.join(BASE, f)
        if os.path.exists(p):
            s.shapes.add_picture(p, Inches(l+0.1), Inches(2.3), Inches(3.8), Inches(3.0))
    except Exception as e:
        print(f"Warning: {e}")
    tx(s, l, 5.7, 4.0, 0.45, t, sz=14, c=c, b=True, a=PP_ALIGN.CENTER)

rc(s, 4.2, 6.5, 4.9, 0.5, EM5)
tx(s, 4.2, 6.52, 4.9, 0.45, "LIVE DEMO  |  istocks.codes", sz=15, c=WHITE, b=True, a=PP_ALIGN.CENTER)


# ==========================================
# SLIDE 5 — FINANCIAL MODEL (P&L from Excel)
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
hd(s, "FINANCIAL MODEL", GLD, "18-Month P&L Projection (Feb 2026 — Jul 2027)")

tx(s, 0.8, 1.7, 11, 0.4,
    "Detailed P&L prepared for AJVC. Full sheet available on request.",
    sz=14, c=G4)

# Top-line metrics
metrics = [
    ("Gross Revenue", "$1.65M", GLD),
    ("Net Revenue", "$996K", EM),
    ("PAT (18m)", "$753K", RGBColor(0x34, 0xD3, 0x99)),
    ("Breakeven", "Month 10-11", BLU),
]
for i, (label, val, c) in enumerate(metrics):
    l = 0.8 + i * 3.1
    cd(s, l, 2.3, 2.8, 1.6, BORDER)
    tx(s, l, 2.45, 2.8, 0.5, val, sz=26, c=c, b=True, a=PP_ALIGN.CENTER)
    tx(s, l, 3.1, 2.8, 0.4, label, sz=13, c=G4, a=PP_ALIGN.CENTER)

# Revenue breakdown
tx(s, 0.8, 4.15, 5, 0.35, "REVENUE STREAMS", sz=12, c=GLD, b=True)

rev_items = [
    ("Brokerage Charges", "$1.52M", "Post-SEBI broker license (Jan 2027)"),
    ("Retail Trader Subs", "$84.6K", "Pro plan at ~$5/month"),
    ("CA Subscriptions", "$38.5K", "Financial professionals"),
    ("Trading Firm Subs", "$3.2K", "Sub-brokers and small firms"),
]
for i, (name, amount, note) in enumerate(rev_items):
    t = 4.6 + i * 0.5
    cd(s, 0.8, t, 6.0, 0.42, BORDER)
    tx(s, 1.0, t+0.03, 2.5, 0.36, name, sz=12, c=WHITE, b=True)
    tx(s, 3.5, t+0.03, 1.5, 0.36, amount, sz=12, c=EM, b=True, a=PP_ALIGN.RIGHT)
    tx(s, 5.2, t+0.03, 1.5, 0.36, note, sz=10, c=G5)

# Cost breakdown
tx(s, 7.5, 4.15, 5, 0.35, "COST STRUCTURE (18m)", sz=12, c=RL, b=True)

cost_items = [
    ("Team (8 FTEs)", "$112K", RL),
    ("Marketing", "$130K", PUR),
    ("Market Data API", "$44.6K", BLU),
    ("LLM API Cost", "$88.5K", EM),
    ("Cloud and Server", "$140K", GLD),
    ("Rent + Admin", "$2.6K", G4),
]
for i, (name, amount, c) in enumerate(cost_items):
    t = 4.6 + i * 0.42
    cd(s, 7.5, t, 5.0, 0.36, BORDER)
    tx(s, 7.7, t+0.02, 2.5, 0.32, name, sz=11, c=G3)
    tx(s, 10.5, t+0.02, 1.8, 0.32, amount, sz=11, c=c, b=True, a=PP_ALIGN.RIGHT)


# ==========================================
# SLIDE 6 — USER GROWTH & REVENUE WATERFALL
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
hd(s, "USER GROWTH", BLU, "User Acquisition and Revenue Waterfall")

tx(s, 0.8, 1.7, 11, 0.4,
    "Conservative projections based on channel-wise conversion funnels. 18-month horizon.",
    sz=14, c=G4)

# User growth milestones
months = [
    ("Month 1", "100", "Beta users\nNo marketing"),
    ("Month 4", "4,000", "Organic + College\nvisits begin"),
    ("Month 9", "27,250", "Telegram + Discord\nchannels active"),
    ("Month 12", "45,000+", "YouTube ads +\nword of mouth"),
    ("Month 18", "75,000+", "Multi-channel\nacquisition"),
]
for i, (m, users, note) in enumerate(months):
    l = 0.4 + i * 2.55
    cd(s, l, 2.3, 2.3, 2.5, BORDER)
    bd(s, l+0.3, 2.4, 1.7, m, BLU)
    tx(s, l, 3.0, 2.3, 0.5, users, sz=24, c=EM, b=True, a=PP_ALIGN.CENTER)
    tx(s, l, 3.5, 2.3, 0.4, "users", sz=11, c=G5, a=PP_ALIGN.CENTER)
    tx(s, l, 3.9, 2.3, 0.7, note, sz=11, c=G4, a=PP_ALIGN.CENTER)
    if i < 4:
        tx(s, l+2.15, 3.1, 0.5, 0.4, ">", sz=16, c=G5, b=True, a=PP_ALIGN.CENTER)

# Acquisition channels
tx(s, 0.8, 5.1, 11, 0.35, "ACQUISITION CHANNELS", sz=12, c=PUR, b=True)

channels = [
    ("College Visits", "$17.6K", "5 colleges/month\n250 signups each", EM),
    ("Trading YouTube", "$33.5K", "2 channels/month\n150 signups each", BLU),
    ("Telegram", "$60.9K", "2,000 signups/month\nHighest volume", PUR),
    ("Discord", "$18.2K", "600 signups/month\nHighest quality", GLD),
]
for i, (name, cost, desc, c) in enumerate(channels):
    l = 0.8 + i * 3.1
    cd(s, l, 5.55, 2.8, 1.5, BORDER)
    tx(s, l, 5.65, 2.8, 0.35, name, sz=13, c=c, b=True, a=PP_ALIGN.CENTER)
    tx(s, l, 5.95, 2.8, 0.3, cost, sz=12, c=G3, a=PP_ALIGN.CENTER)
    tx(s, l, 6.3, 2.8, 0.6, desc, sz=10, c=G5, a=PP_ALIGN.CENTER)


# ==========================================
# SLIDE 7 — SDG IMPACT
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
hd(s, "SOCIAL IMPACT", UN, "Aligned with UN Sustainable Development Goals")

sdgs = [
    ("SDG 1", "No Poverty",
     "90%+ of low-income Indians\ncannot access the stock market\ndue to language and complexity\nbarriers. iStocks gives them\nalgo trading in their own language.",
     RED, "Financial access for\n90%+ low-income Indians"),
    ("SDG 8", "Decent Work &\nEconomic Growth",
     "Daily job workers can set their\ntrading strategy once and continue\nworking. AI executes automatically\nand sends phone notifications.\nNo screen-time needed.",
     BLU, "Set strategy, go to work.\nAI trades for you."),
    ("SDG 10", "Reduced\nInequalities",
     "We are not just serving college\nstudents. We give institutional-\ngrade financial intelligence to\nevery Indian — in 40+ regional\nlanguages, completely code-free.",
     EM5, "Equal access in every\nIndian language"),
]
for i, (sdg, title, desc, c, impact) in enumerate(sdgs):
    l = 0.8 + i * 4.1
    cd(s, l, 2.0, 3.8, 4.8, c)
    bd(s, l+0.8, 2.2, 2.2, f"{sdg}: {title}", c)
    tx(s, l+0.3, 3.0, 3.2, 2.2, desc, sz=13, c=G3, a=PP_ALIGN.CENTER)
    cd(s, l+0.3, 5.5, 3.2, 0.9, BORDER)
    tx(s, l+0.3, 5.6, 3.2, 0.7, impact, sz=12, c=c, b=True, a=PP_ALIGN.CENTER)


# ==========================================
# SLIDE 8 — COMPETITIVE ADVANTAGE
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
hd(s, "COMPETITIVE ADVANTAGE", EM, "Why iStocks Wins")

tx(s, 0.8, 1.7, 11, 0.4,
    "First platform in India to enable AI-powered stock analysis and prompt-based algo trading — no code required.",
    sz=14, c=G4)

heads = ["Feature", "iStocks", "Zerodha", "Groww", "Smallcase"]
hc = [G5, EM5, G5, G5, G5]
for i, (h, c) in enumerate(zip(heads, hc)):
    l = 0.8 + i * 2.5
    b = EM5 if i == 1 else CARD
    rc(s, l, 2.3, 2.3, 0.48, b, BORDER)
    tx(s, l, 2.32, 2.3, 0.44, h, sz=13, c=WHITE if i==1 else c, b=True, a=PP_ALIGN.CENTER)

rows = [
    ("AI Analysis",       "Angle 1.0",   "None",    "None",    "None"),
    ("NL Database Chat",  "Full SQL",    "None",    "None",    "None"),
    ("Algo Trading",      "Prompt-based","API only","None",    "None"),
    ("Regional Language", "40+ langs",   "None",    "None",    "None"),
    ("Free Tier",         "10 queries",  "Limited", "Paid",    "Paid"),
    ("Real-Time Data",    "2s refresh",  "Yes",     "Yes",     "Delayed"),
    ("40+ Indicators",    "Yes",         "Basic",   "Basic",   "None"),
]
for j, row in enumerate(rows):
    top = 2.9 + j * 0.52
    for i, v in enumerate(row):
        l = 0.8 + i * 2.5
        if i == 1: bgc = RGBColor(0x0D, 0x1F, 0x17)
        else: bgc = CARD if j % 2 == 0 else CARD_ALT
        rc(s, l, top, 2.3, 0.45, bgc, BORDER)
        tx(s, l, top+0.02, 2.3, 0.41, v, sz=11,
           c=EM if i==1 else G3, b=(i==0), a=PP_ALIGN.CENTER)


# ==========================================
# SLIDE 9 — THE ASK (with P&L backed numbers)
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
hd(s, "THE ASK", GLD, "Why We Need $1M and How We Will Use It")

tx(s, 0.8, 1.7, 11, 0.5,
    "Our P&L model shows breakeven in Month 10-11 with $753K PAT over 18 months.\nThe $1M accelerates us to profitability faster and enables global expansion.",
    sz=15, c=G4)

allocs = [
    ("40%", "$400K", "Technology & AI", "LLM API cost: $88.5K\nCloud infra: $140K\nMarket Data API: $44.6K\nAngle 1.1 scaling", BLU),
    ("25%", "$250K", "User Acquisition", "Marketing: $130K\nCollege visits: $17.6K\nYouTube + Telegram\nDiscord channels", EM5),
    ("20%", "$200K", "Team (8 FTEs)", "Team cost: $112K\n2 Founders, 2 Devs\n1 Marketing, 1 Legal\n1 Mobile Dev", PUR),
    ("15%", "$150K", "Compliance", "SEBI broker license\nBy Jan 2027\nUnlocks brokerage\nrevenue: $1.52M", GLD),
]
for i, (pct, amt, title, desc, c) in enumerate(allocs):
    l = 0.8 + i * 3.1
    cd(s, l, 2.6, 2.8, 4.2, BORDER)
    tx(s, l, 2.8, 2.8, 0.6, pct, sz=32, c=c, b=True, a=PP_ALIGN.CENTER)
    tx(s, l, 3.3, 2.8, 0.35, amt, sz=14, c=G3, a=PP_ALIGN.CENTER)
    br(s, l+0.6, 3.75, 1.6, c)
    tx(s, l, 3.85, 2.8, 0.4, title, sz=14, c=WHITE, b=True, a=PP_ALIGN.CENTER)
    tx(s, l+0.2, 4.35, 2.4, 1.8, desc, sz=11, c=G4, a=PP_ALIGN.CENTER)


# ==========================================
# SLIDE 10 — TEAM + THANK YOU (combined)
# ==========================================
s = prs.slides.add_slide(prs.slide_layouts[6]); bg(s)
br(s, 0, 0, 13.333)

# Left side: Team
tx(s, 0.8, 0.4, 5, 0.35, "THE TEAM", sz=12, c=EM, b=True)
tx(s, 0.8, 0.8, 5, 0.5, "IIT Roorkee Engineers", sz=28, c=WHITE, b=True)

# Member 1
cd(s, 0.8, 1.6, 2.8, 2.8, EM5)
ci(s, 1.5, 1.75, 1.0, EM5)
tx(s, 1.5, 1.85, 1.0, 0.8, "P", sz=32, c=WHITE, b=True, a=PP_ALIGN.CENTER)
tx(s, 0.8, 2.85, 2.8, 0.4, "Priyanshu", sz=18, c=WHITE, b=True, a=PP_ALIGN.CENTER)
tx(s, 0.8, 3.25, 2.8, 0.3, "Captain | Full-Stack Dev", sz=11, c=EM, a=PP_ALIGN.CENTER)
tx(s, 0.8, 3.55, 2.8, 0.7, "Built entire platform:\nAI, Backend, Frontend, DevOps", sz=10, c=G4, a=PP_ALIGN.CENTER)

# Member 2
cd(s, 3.9, 1.6, 2.8, 2.8, BLU)
ci(s, 4.6, 1.75, 1.0, BLU)
tx(s, 4.6, 1.85, 1.0, 0.8, "T", sz=32, c=WHITE, b=True, a=PP_ALIGN.CENTER)
tx(s, 3.9, 2.85, 2.8, 0.4, "[Member 2]", sz=18, c=WHITE, b=True, a=PP_ALIGN.CENTER)
tx(s, 3.9, 3.25, 2.8, 0.3, "Co-Founder | [Role]", sz=11, c=BLU, a=PP_ALIGN.CENTER)
tx(s, 3.9, 3.55, 2.8, 0.7, "[Specialization]\n[Key Contribution]", sz=10, c=G4, a=PP_ALIGN.CENTER)

# Right side: Thank You + Contact
tx(s, 7.5, 1.0, 5.5, 0.8, "Thank You.", sz=48, c=WHITE, b=True, a=PP_ALIGN.CENTER)
tx(s, 7.5, 1.8, 5.5, 0.5, "Let's make financial intelligence", sz=18, c=G3, a=PP_ALIGN.CENTER)
tx(s, 7.5, 2.2, 5.5, 0.6, "UNLIMITED.", sz=36, c=EM, b=True, a=PP_ALIGN.CENTER)

# Contact card
cd(s, 7.5, 3.0, 5.0, 1.9, EM5)
tx(s, 7.5, 3.1, 5.0, 0.4, "istocks.codes", sz=20, c=EM, b=True, a=PP_ALIGN.CENTER)
tx(s, 7.5, 3.5, 5.0, 0.3, "priyanshu85953@gmail.com", sz=13, c=G3, a=PP_ALIGN.CENTER)
tx(s, 7.5, 3.8, 5.0, 0.3, "IIT Roorkee  |  Team iStocks", sz=13, c=G3, a=PP_ALIGN.CENTER)
tx(s, 7.5, 4.15, 5.0, 0.4, "Hult Prize 2026  |  UNLIMITED", sz=14, c=GLD, b=True, a=PP_ALIGN.CENTER)

# Links
cd(s, 0.8, 4.7, 11.7, 1.2, BORDER)
tx(s, 0.8, 4.8, 11.7, 0.35, "RESOURCES", sz=12, c=GLD, b=True, a=PP_ALIGN.CENTER)
_, tf = tx(s, 1.0, 5.15, 11.3, 0.3, "Live Platform:  istocks.codes", sz=13, c=EM, a=PP_ALIGN.LEFT)
pa(tf, "P&L Structure:  docs.google.com/spreadsheets  (Available on request)", sz=13, c=G3, sa=4)
pa(tf, "Competitive Landscape:  drive.google.com  (Available on request)", sz=13, c=G3, sa=4)

# SDG bar
rc(s, 0.8, 6.3, 11.7, 0.4, UN)
tx(s, 0.8, 6.32, 11.7, 0.36,
   "SDG 1: No Poverty   |   SDG 8: Economic Growth   |   SDG 10: Reduced Inequalities",
   sz=11, c=WHITE, b=True, a=PP_ALIGN.CENTER)

br(s, 0, 7.44, 13.333)


# ============= SAVE =============
out = os.path.join(BASE, "iStocks_HultPrize_2026.pptx")
prs.save(out)
print(f"Saved: {out}")
print(f"Slides: {len(prs.slides)}")
