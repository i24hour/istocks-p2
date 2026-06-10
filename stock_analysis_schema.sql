--
-- PostgreSQL database dump
--

\restrict FdGj3RPTpK7yV1TRaVH4GsfTGm6wFgSmHwDEF7o8fhgrxAyWJWdQSOmJRjx6TCW

-- Dumped from database version 14.19 (Homebrew)
-- Dumped by pg_dump version 14.19 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Stock; Type: TABLE; Schema: public; Owner: priyanshu
--

CREATE TABLE public."Stock" (
    id text NOT NULL,
    symbol text NOT NULL,
    name text NOT NULL,
    exchange text DEFAULT 'NSE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Stock" OWNER TO priyanshu;

--
-- Name: StockInsight; Type: TABLE; Schema: public; Owner: priyanshu
--

CREATE TABLE public."StockInsight" (
    id text NOT NULL,
    "stockId" text NOT NULL,
    timeframe text NOT NULL,
    trend text NOT NULL,
    "trendStrength" double precision NOT NULL,
    momentum text NOT NULL,
    volatility text NOT NULL,
    "volumeAnalysis" text NOT NULL,
    "supportLevel" double precision,
    "resistanceLevel" double precision,
    summary text NOT NULL,
    "generatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."StockInsight" OWNER TO priyanshu;

--
-- Name: StockPrice; Type: TABLE; Schema: public; Owner: priyanshu
--

CREATE TABLE public."StockPrice" (
    id text NOT NULL,
    "stockId" text NOT NULL,
    "timestamp" timestamp(3) without time zone NOT NULL,
    open double precision NOT NULL,
    high double precision NOT NULL,
    low double precision NOT NULL,
    close double precision NOT NULL,
    volume bigint NOT NULL,
    sma20 double precision,
    sma50 double precision,
    sma200 double precision,
    ema12 double precision,
    ema26 double precision,
    macd double precision,
    "macdSignal" double precision,
    "macdHistogram" double precision,
    adx double precision,
    "plusDI" double precision,
    "minusDI" double precision,
    rsi double precision,
    "stochK" double precision,
    "stochD" double precision,
    cci double precision,
    "williamsR" double precision,
    roc double precision,
    "bbUpper" double precision,
    "bbMiddle" double precision,
    "bbLower" double precision,
    atr double precision,
    obv bigint,
    vwap double precision,
    "forceIndex" double precision,
    "adLine" double precision,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."StockPrice" OWNER TO priyanshu;

--
-- Name: StockInsight StockInsight_pkey; Type: CONSTRAINT; Schema: public; Owner: priyanshu
--

ALTER TABLE ONLY public."StockInsight"
    ADD CONSTRAINT "StockInsight_pkey" PRIMARY KEY (id);


--
-- Name: StockPrice StockPrice_pkey; Type: CONSTRAINT; Schema: public; Owner: priyanshu
--

ALTER TABLE ONLY public."StockPrice"
    ADD CONSTRAINT "StockPrice_pkey" PRIMARY KEY (id);


--
-- Name: Stock Stock_pkey; Type: CONSTRAINT; Schema: public; Owner: priyanshu
--

ALTER TABLE ONLY public."Stock"
    ADD CONSTRAINT "Stock_pkey" PRIMARY KEY (id);


--
-- Name: StockInsight_stockId_idx; Type: INDEX; Schema: public; Owner: priyanshu
--

CREATE INDEX "StockInsight_stockId_idx" ON public."StockInsight" USING btree ("stockId");


--
-- Name: StockInsight_stockId_timeframe_key; Type: INDEX; Schema: public; Owner: priyanshu
--

CREATE UNIQUE INDEX "StockInsight_stockId_timeframe_key" ON public."StockInsight" USING btree ("stockId", timeframe);


--
-- Name: StockPrice_stockId_timestamp_idx; Type: INDEX; Schema: public; Owner: priyanshu
--

CREATE INDEX "StockPrice_stockId_timestamp_idx" ON public."StockPrice" USING btree ("stockId", "timestamp" DESC);


--
-- Name: StockPrice_stockId_timestamp_key; Type: INDEX; Schema: public; Owner: priyanshu
--

CREATE UNIQUE INDEX "StockPrice_stockId_timestamp_key" ON public."StockPrice" USING btree ("stockId", "timestamp");


--
-- Name: StockPrice_timestamp_idx; Type: INDEX; Schema: public; Owner: priyanshu
--

CREATE INDEX "StockPrice_timestamp_idx" ON public."StockPrice" USING btree ("timestamp");


--
-- Name: Stock_symbol_idx; Type: INDEX; Schema: public; Owner: priyanshu
--

CREATE INDEX "Stock_symbol_idx" ON public."Stock" USING btree (symbol);


--
-- Name: Stock_symbol_key; Type: INDEX; Schema: public; Owner: priyanshu
--

CREATE UNIQUE INDEX "Stock_symbol_key" ON public."Stock" USING btree (symbol);


--
-- Name: StockInsight StockInsight_stockId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: priyanshu
--

ALTER TABLE ONLY public."StockInsight"
    ADD CONSTRAINT "StockInsight_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES public."Stock"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StockPrice StockPrice_stockId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: priyanshu
--

ALTER TABLE ONLY public."StockPrice"
    ADD CONSTRAINT "StockPrice_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES public."Stock"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict FdGj3RPTpK7yV1TRaVH4GsfTGm6wFgSmHwDEF7o8fhgrxAyWJWdQSOmJRjx6TCW

