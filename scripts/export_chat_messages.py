import psycopg2
import csv
import os
from logzero import logger

# Read DB URL from env to support local/prod safely.
DATABASE_URL = os.getenv("DATABASE_URL")

OUTPUT_FILE = "chat_messages.csv"

def export_chat_messages():
    try:
        if not DATABASE_URL:
            raise ValueError("DATABASE_URL is not set in environment")

        logger.info("🚀 Connecting to database...")
        conn = psycopg2.connect(DATABASE_URL)
        cursor = conn.cursor()

        logger.info("📊 Fetching chat messages with user email...")
        cursor.execute("""
            SELECT
                cm.*,
                cs."userId",
                u.email AS "userEmail"
            FROM "ChatMessage" cm
            LEFT JOIN "ChatSession" cs
                ON cs.id = cm."sessionId"
            LEFT JOIN "User" u
                ON u.id = cs."userId"
            ORDER BY cm."createdAt" ASC
        """)
        
        # Get column names
        colnames = [desc[0] for desc in cursor.description]
        
        rows = cursor.fetchall()
        logger.info(f"✅ Fetched {len(rows)} messages.")

        logger.info(f"💾 Writing to {OUTPUT_FILE}...")
        with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(colnames)  # Write header
            writer.writerows(rows)     # Write data

        logger.info(f"🎉 Export complete! File saved as: {os.path.abspath(OUTPUT_FILE)}")

        cursor.close()
        conn.close()

    except Exception as e:
        logger.error(f"❌ Error: {e}")

if __name__ == "__main__":
    export_chat_messages()
