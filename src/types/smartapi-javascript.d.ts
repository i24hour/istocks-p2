declare module 'smartapi-javascript' {
    export class SmartAPI {
        constructor(config: { api_key: string; session_expiration_limit?: number });
        generateSession(client_code: string, password: string, totp: string): Promise<any>;
    }
    export class WebSocketV2 {
        constructor(config: { jwttoken: string; apikey: string; clientcode: string; feedtype: string });
        connect(): Promise<void>;
        subscribe(request: any): void;
        on(event: string, callback: (data: any) => void): void;
    }
}
