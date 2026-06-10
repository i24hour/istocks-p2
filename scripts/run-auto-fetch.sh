#!/bin/bash
# Daily stock data auto-fetch cron job
# Runs every day at 4:00 PM (after market close at 3:30 PM)

# Navigate to project directory
cd /Users/priyanshu/Desktop/Desktop/Github/istocks-p

# Activate virtual environment (if you have one)
# source venv/bin/activate

# Run the Python script
python3 scripts/auto-fetch-stock-data.py >> logs/auto-fetch-$(date +\%Y-\%m-\%d).log 2>&1

echo "Auto-fetch completed at $(date)"
