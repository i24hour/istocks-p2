# EC2 Live Price Server

Real-time stock price streaming server for iStocks using Angel One WebSocket.

## Architecture

```
Angel One ─── WebSocket ───► EC2 (Python FastAPI) ─── REST ───► Frontend
                                    │
                               In-Memory Dict
                               {NIFTY: 25343, ...}
```

## Local Testing

```bash
cd ec2-live-server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

Then open: http://localhost:8080/health

## EC2 Deployment Steps

### 1. Launch EC2 Instance
- **AMI:** Ubuntu 22.04 LTS
- **Instance Type:** t3.nano (₹300/month) or t3.micro
- **Security Group:** Allow TCP 8080 from anywhere

### 2. Copy Files to EC2
```bash
scp -i your-key.pem -r ec2-live-server/* ubuntu@YOUR_EC2_IP:/home/ubuntu/
```

### 3. Run Deployment Script
```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
cd ~
chmod +x deploy.sh
./deploy.sh
```

### 4. Verify
```bash
curl http://YOUR_EC2_IP:8080/health
curl http://YOUR_EC2_IP:8080/prices
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /prices` | All live prices |
| `GET /prices/{symbol}` | Single stock price |
| `GET /stream` | SSE real-time stream |

## Adding More Stocks

Edit `STOCK_TOKENS` in `main.py`:

```python
STOCK_TOKENS = {
    "NIFTY": {"token": "99926000", "exchange": 1},
    "NEWSTOCK": {"token": "12345", "exchange": 1},
    # ...
}
```

Token IDs can be found in Angel One's instrument master file.

## Commands

```bash
# Check service status
sudo systemctl status istocks-live

# View logs
sudo journalctl -u istocks-live -f

# Restart service
sudo systemctl restart istocks-live
```
