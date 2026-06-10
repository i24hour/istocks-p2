# iStocks Live Price Server - EC2 Deployment Guide

## What's New (v2.0.0)
- **Market Hours Scheduler**: Auto-connects at 9 AM IST, disconnects at 3:30 PM IST
- **Auto-Reconnect**: If WebSocket drops during market hours, retries up to 5 times
- **Daily Fresh Login**: New Angel One session every morning
- **Graceful Shutdown**: Clean disconnection after market close
- **Health Endpoint**: Shows market status, connection state, reconnect attempts

---

## Deployment Steps

### 1. SSH into your EC2 instance
```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
```

### 2. Upload the updated files

Option A: Use SCP
```bash
scp -i your-key.pem temp_ec2_update/* ubuntu@your-ec2-ip:/home/ubuntu/istocks-live/
```

Option B: Git pull (if repo is on EC2)
```bash
cd /home/ubuntu/istocks-live
git pull origin main
```

### 3. Install new dependencies
```bash
cd /home/ubuntu/istocks-live
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Set up systemd service (for auto-restart)
```bash
# Copy service file
sudo cp istocks-live.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable istocks-live

# Start the service
sudo systemctl start istocks-live

# Check status
sudo systemctl status istocks-live
```

### 5. View logs
```bash
# Live logs
sudo journalctl -u istocks-live -f

# Or check log file
tail -f /var/log/istocks-live.log
```

---

## Useful Commands

```bash
# Restart service
sudo systemctl restart istocks-live

# Stop service
sudo systemctl stop istocks-live

# Check health
curl http://localhost:8080/health

# Force reconnect (during market hours)
curl -X POST http://localhost:8080/reconnect

# Get current prices
curl http://localhost:8080/prices
```

---

## Expected Behavior

| Time (IST)       | Server Status                          |
|------------------|----------------------------------------|
| Before 9:00 AM   | Waiting for market open                |
| 9:00 AM          | Auto-connects, starts streaming prices |
| 9:00 AM - 3:30 PM| Active, auto-reconnects if disconnected|
| 3:30 PM          | Gracefully disconnects                 |
| After 3:30 PM    | Sleeping, waiting for next day         |

---

## Health Check Response Example

```json
{
  "status": "healthy",
  "websocket_connected": true,
  "market_status": "OPEN",
  "current_time_ist": "2026-02-09 14:30:00",
  "stocks_tracked": 17,
  "db_closes_loaded": 15,
  "reconnect_attempts": 0
}
```
