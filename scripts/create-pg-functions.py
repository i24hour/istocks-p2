import os
#!/usr/bin/env python3
"""
Create PostgreSQL helper function for round(double precision, integer)
This provides a fallback for AI-generated queries that don't cast to numeric.
"""

import psycopg2
from logzero import logger

# ==== Azure PostgreSQL ====
AZURE_DATABASE_URL = os.getenv("DATABASE_URL")

def main():
    logger.info("=" * 60)
    logger.info("🔧 CREATING POSTGRESQL HELPER FUNCTIONS")
    logger.info("=" * 60)

    try:
        conn = psycopg2.connect(AZURE_DATABASE_URL)
        cursor = conn.cursor()
        logger.info("✅ Connected to Azure PostgreSQL")
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return

    # Create round(double precision, integer) function
    create_round_function = """
    CREATE OR REPLACE FUNCTION round(val double precision, dp integer)
    RETURNS numeric
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
    BEGIN
        RETURN round(val::numeric, dp);
    END;
    $$;
    """

    try:
        cursor.execute(create_round_function)
        conn.commit()
        logger.info("✅ Created round(double precision, integer) function")
    except Exception as e:
        logger.error(f"❌ Error creating round function: {e}")
        conn.rollback()

    # Create trunc(double precision, integer) function
    create_trunc_function = """
    CREATE OR REPLACE FUNCTION trunc(val double precision, dp integer)
    RETURNS numeric
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
    BEGIN
        RETURN trunc(val::numeric, dp);
    END;
    $$;
    """

    try:
        cursor.execute(create_trunc_function)
        conn.commit()
        logger.info("✅ Created trunc(double precision, integer) function")
    except Exception as e:
        logger.error(f"❌ Error creating trunc function: {e}")
        conn.rollback()

    # Test the functions
    try:
        cursor.execute("SELECT round(123.456::double precision, 2)")
        result = cursor.fetchone()
        logger.info(f"✅ round() test: round(123.456, 2) = {result[0]}")

        cursor.execute("SELECT trunc(123.456::double precision, 1)")
        result = cursor.fetchone()
        logger.info(f"✅ trunc() test: trunc(123.456, 1) = {result[0]}")
    except Exception as e:
        logger.error(f"❌ Error testing functions: {e}")

    conn.close()
    logger.info("\n" + "=" * 60)
    logger.info("🎉 POSTGRESQL HELPER FUNCTIONS CREATED!")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
