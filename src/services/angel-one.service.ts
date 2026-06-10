import axios from 'axios'

interface AngelOneConfig {
  apiKey: string
  clientId: string
  secretKey: string
  totpToken: string
}

interface HistoricalDataParams {
  exchange: string
  symboltoken: string
  interval: string
  fromdate: string
  todate: string
}

// Function to generate TOTP
function generateTOTP(secret: string): string {
  const crypto = require('crypto')
  const base32 = require('hi-base32')
  
  const epoch = Math.floor(Date.now() / 1000)
  const timeStep = 30
  const counter = Math.floor(epoch / timeStep)
  
  const decodedSecret = base32.decode.asBytes(secret)
  const buffer = Buffer.alloc(8)
  buffer.writeBigInt64BE(BigInt(counter))
  
  const hmac = crypto.createHmac('sha1', Buffer.from(decodedSecret))
  hmac.update(buffer)
  const hash = hmac.digest()
  
  const offset = hash[hash.length - 1] & 0xf
  const binary = ((hash[offset] & 0x7f) << 24) |
                 ((hash[offset + 1] & 0xff) << 16) |
                 ((hash[offset + 2] & 0xff) << 8) |
                 (hash[offset + 3] & 0xff)
  
  const otp = binary % 1000000
  return otp.toString().padStart(6, '0')
}

class AngelOneService {
  private config: AngelOneConfig
  private jwtToken: string | null = null
  private feedToken: string | null = null
  private baseUrl = 'https://apiconnect.angelbroking.com'

  constructor() {
    this.config = {
      apiKey: process.env.ANGELONE_API_KEY || '',
      clientId: process.env.ANGELONE_CLIENT_ID || '',
      secretKey: process.env.ANGELONE_SECRET_KEY || '',
      totpToken: process.env.ANGELONE_TOTP_TOKEN || '',
    }
  }

  async login(): Promise<void> {
    try {
      // Generate TOTP
      const totp = generateTOTP(this.config.totpToken)
      console.log('Generated TOTP:', totp)

      const response = await axios.post(`${this.baseUrl}/rest/auth/angelbroking/user/v1/loginByPassword`, {
        clientcode: this.config.clientId,
        password: this.config.secretKey,
        totp: totp,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': '127.0.0.1',
          'X-MACAddress': '00:00:00:00:00:00',
          'X-PrivateKey': this.config.apiKey,
        },
      })

      if (response.data.status && response.data.data) {
        this.jwtToken = response.data.data.jwtToken
        this.feedToken = response.data.data.feedToken
        console.log('✅ Successfully authenticated with Angel One')
      } else {
        throw new Error('Authentication failed: ' + JSON.stringify(response.data))
      }
    } catch (error: any) {
      console.error('Angel One login failed:', error.response?.data || error.message)
      throw error
    }
  }

  async getSymbolToken(stockName: string, exchange: string = 'NSE'): Promise<string | null> {
    try {
      const response = await axios.get('https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json')
      const data = response.data
      
      const stock = data.find((item: any) => 
        item.name.toLowerCase() === stockName.toLowerCase() && 
        item.exch_seg === exchange
      )
      
      return stock ? stock.token : null
    } catch (error) {
      console.error('Error fetching symbol token:', error)
      return null
    }
  }

  async getHistoricalData(params: HistoricalDataParams): Promise<any> {
    if (!this.jwtToken) {
      await this.login()
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/rest/secure/angelbroking/historical/v1/getCandleData`,
        params,
        {
          headers: {
            'Authorization': `Bearer ${this.jwtToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': '127.0.0.1',
            'X-ClientPublicIP': '127.0.0.1',
            'X-MACAddress': '00:00:00:00:00:00',
            'X-PrivateKey': this.config.apiKey,
          },
        }
      )

      return response.data
    } catch (error: any) {
      console.error('Failed to fetch historical data:', error.response?.data || error.message)
      throw error
    }
  }

  async getHistoricalDataInChunks(
    token: string,
    startDate: Date,
    endDate: Date,
    interval: string = 'ONE_MINUTE'
  ): Promise<any[]> {
    const allData: any[] = []
    let currentStartDate = new Date(startDate)

    while (currentStartDate < endDate) {
      // Calculate chunk end date (30 days)
      const currentEndDate = new Date(currentStartDate)
      currentEndDate.setDate(currentEndDate.getDate() + 30)
      
      if (currentEndDate > endDate) {
        currentEndDate.setTime(endDate.getTime())
      }

      // Format dates
      const fromDateStr = this.formatDate(currentStartDate)
      const toDateStr = this.formatDate(currentEndDate)

      console.log(`📊 Fetching data from ${fromDateStr} to ${toDateStr}`)

      try {
        const params: HistoricalDataParams = {
          exchange: 'NSE',
          symboltoken: token,
          interval: interval,
          fromdate: fromDateStr,
          todate: toDateStr,
        }

        const result = await this.getHistoricalData(params)

        if (result.data && result.data.data) {
          allData.push(...result.data.data)
          console.log(`✅ Fetched ${result.data.data.length} records`)
        } else {
          console.log(`⚠️ No data for period ${fromDateStr} to ${toDateStr}`)
        }

        // Wait a bit to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        console.error(`❌ Error fetching chunk ${fromDateStr} to ${toDateStr}:`, error)
      }

      // Move to next chunk
      currentStartDate = currentEndDate
    }

    return allData
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  }

  async getWiproData(fromDate: string, toDate: string, interval: string = 'ONE_MINUTE'): Promise<any> {
    const token = await this.getSymbolToken('WIPRO', 'NSE')
    
    if (!token) {
      throw new Error('Could not find token for WIPRO')
    }

    console.log('✅ Found WIPRO token:', token)

    const start = new Date(fromDate)
    const end = new Date(toDate)

    const data = await this.getHistoricalDataInChunks(token, start, end, interval)

    return {
      success: true,
      data: {
        data: data
      }
    }
  }
}

export const angelOneService = new AngelOneService()
