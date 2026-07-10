#!/usr/bin/env python3
import argparse
import json
import math
from datetime import datetime, timedelta

import akshare as ak
import pandas as pd


def clean(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def number(value):
    value = clean(value)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_date(value):
    value = clean(value)
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace(" 00:00:00", "")
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(text[:10] if fmt != "%Y%m%d" else text[:8], fmt)
        except ValueError:
            continue
    return None


def quarter_end_dates(limit=10):
    today = datetime.utcnow()
    ends = []
    year = today.year
    for _ in range(3):
        for month, day in [(12, 31), (9, 30), (6, 30), (3, 31)]:
            date = datetime(year, month, day)
            if date <= today:
                ends.append(date.strftime("%Y%m%d"))
        year -= 1
    return ends[:limit]


def months_between(start, end):
    if not start or not end:
        return None
    return (end.year - start.year) * 12 + end.month - start.month + 1


def period_from_dates(row, market):
    report_date = parse_date(row.get("REPORT_DATE") or row.get("STD_REPORT_DATE") or row.get("report_date"))
    start_date = parse_date(row.get("START_DATE") or row.get("start_date"))
    report_type = clean(row.get("REPORT_TYPE"))

    if market == "US" and report_type and "/" in str(report_type):
        year_text, quarter = str(report_type).split("/", 1)
        try:
            fiscal_year = int(year_text)
            fiscal_quarter = quarter.upper()
            return fiscal_year, fiscal_quarter, f"{fiscal_year} {fiscal_quarter}"
        except ValueError:
            pass

    if not report_date:
        return datetime.utcnow().year, "Q1", f"{datetime.utcnow().year} Q1"

    span = months_between(start_date, report_date)
    fiscal_year = report_date.year
    if span and span >= 10:
        return fiscal_year, "FY", f"{fiscal_year} FY"

    quarter_by_month = {3: "Q1", 6: "Q2", 9: "Q3", 12: "Q4"}
    fiscal_quarter = quarter_by_month.get(report_date.month, f"Q{((report_date.month - 1) // 3) + 1}")
    return fiscal_year, fiscal_quarter, f"{fiscal_year} {fiscal_quarter}"


def metric(name, normalized, value, unit, source, yoy_value=None, qoq_value=None, confidence=0.68):
    if value is None:
        return None
    return {
        "name": name,
        "normalized": normalized,
        "value": round(value, 4) if unit != "%" else round(value, 1),
        "unit": unit,
        "yoy": None if yoy_value is None else round(yoy_value, 1),
        "qoq": None if qoq_value is None else round(qoq_value, 1),
        "sourceAnchor": source,
        "confidence": confidence,
    }


def unit_from_currency(currency):
    if currency == "USD":
        return "USD bn"
    if currency == "HKD":
        return "HKD bn"
    return "RMB bn"


def report_from_indicator_row(row, market, currency, source_title):
    unit = unit_from_currency(currency)
    report_date = parse_date(row.get("REPORT_DATE") or row.get("STD_REPORT_DATE") or row.get("report_date"))
    release_date = parse_date(row.get("NOTICE_DATE") or row.get("最新公告日期") or row.get("公告日期"))
    fiscal_year, fiscal_quarter, period_label = period_from_dates(row, market)
    date_label = report_date.strftime("%Y-%m-%d") if report_date else period_label
    source = f"AkShare third-party data via {source_title}; reportDate={date_label}"

    if market == "CN":
        revenue = number(row.get("营业总收入-营业总收入"))
        gross_margin = number(row.get("销售毛利率"))
        gross_profit = revenue * gross_margin / 100 if revenue is not None and gross_margin is not None else None
        net_income = number(row.get("净利润-净利润"))
        metrics = [
            metric("Revenue", "revenue", None if revenue is None else revenue / 1_000_000_000, unit, source, number(row.get("营业总收入-同比增长")), number(row.get("营业总收入-季度环比增长"))),
            metric("Gross profit", "gross_profit", None if gross_profit is None else gross_profit / 1_000_000_000, unit, source, None, None, 0.62),
            metric("Gross margin", "gross_margin", gross_margin, "%", source, None, None, 0.62),
            metric("Net income attributable", "net_income_attributable", None if net_income is None else net_income / 1_000_000_000, unit, source, number(row.get("净利润-同比增长")), number(row.get("净利润-季度环比增长"))),
        ]
    else:
        net_field = "PARENT_HOLDER_NETPROFIT" if market == "US" else "HOLDER_PROFIT"
        net_yoy_field = "PARENT_HOLDER_NETPROFIT_YOY" if market == "US" else "HOLDER_PROFIT_YOY"
        net_qoq_field = "PARENT_HOLDER_NETPROFIT_QOQ" if market == "US" else "HOLDER_PROFIT_QOQ"
        metrics = [
            metric("Revenue", "revenue", number(row.get("OPERATE_INCOME")) / 1_000_000_000 if number(row.get("OPERATE_INCOME")) is not None else None, unit, source, number(row.get("OPERATE_INCOME_YOY")), number(row.get("OPERATE_INCOME_QOQ"))),
            metric("Gross profit", "gross_profit", number(row.get("GROSS_PROFIT")) / 1_000_000_000 if number(row.get("GROSS_PROFIT")) is not None else None, unit, source, number(row.get("GROSS_PROFIT_YOY")), number(row.get("GROSS_PROFIT_QOQ"))),
            metric("Gross margin", "gross_margin", number(row.get("GROSS_PROFIT_RATIO")), "%", source, number(row.get("GROSS_PROFIT_RATIO_YOY")), None),
            metric("Net income attributable", "net_income_attributable", number(row.get(net_field)) / 1_000_000_000 if number(row.get(net_field)) is not None else None, unit, source, number(row.get(net_yoy_field)), number(row.get(net_qoq_field))),
        ]

    return {
        "fiscalYear": fiscal_year,
        "fiscalQuarter": fiscal_quarter,
        "periodLabel": period_label,
        "reportDate": report_date.strftime("%Y-%m-%d") if report_date else None,
        "releaseDate": release_date.strftime("%Y-%m-%d") if release_date else None,
        "currencyUnit": unit,
        "metrics": [item for item in metrics if item is not None],
    }


def source_url(args):
    if args.market == "HK":
        return f"https://emweb.securities.eastmoney.com/PC_HKF10/NewFinancialAnalysis/index?type=web&code={args.hkex_code}"
    if args.market == "US":
        symbol = args.ticker.split(".")[0]
        return f"https://emweb.eastmoney.com/PC_USF10/pages/index.html?code={symbol}&type=web&color=w#/cwfx/zyzb"
    return "https://data.eastmoney.com/bbsj/"


def fetch_hk(args):
    symbol = args.hkex_code.zfill(5)
    df = ak.stock_financial_hk_analysis_indicator_em(symbol=symbol, indicator="报告期")
    return [
        report_from_indicator_row(row, "HK", args.currency, "AkShare/EastMoney HK financial indicators")
        for row in df.head(args.limit).to_dict(orient="records")
    ]


def fetch_us(args):
    symbol = args.ticker.split(".")[0]
    df = ak.stock_financial_us_analysis_indicator_em(symbol=symbol, indicator="单季报")
    return [
        report_from_indicator_row(row, "US", args.currency, "AkShare/EastMoney US financial indicators")
        for row in df.head(args.limit).to_dict(orient="records")
    ]


def cninfo_url(symbol, year, quarter):
    category_by_quarter = {"Q1": "一季报", "Q2": "半年报", "Q3": "三季报", "FY": "年报", "Q4": "年报"}
    category = category_by_quarter.get(quarter, "")
    try:
        df = ak.stock_zh_a_disclosure_report_cninfo(
            symbol=symbol,
            market="沪深京",
            category=category,
            start_date=f"{year}0101",
            end_date=f"{year}1231",
        )
    except Exception:
        return None
    if df.empty:
        return None
    link = clean(df.iloc[0].get("公告链接"))
    return str(link) if link else None


def fetch_cn(args):
    symbol = args.ticker.split(".")[0]
    reports = []
    for date in quarter_end_dates(limit=args.limit + 4):
        df = ak.stock_yjbb_em(date=date)
        if "股票代码" not in df.columns:
            continue
        matched = df[df["股票代码"].astype(str).str.zfill(6) == symbol.zfill(6)]
        if matched.empty:
            continue
        row = matched.iloc[0].to_dict()
        report_date = datetime.strptime(date, "%Y%m%d")
        row["report_date"] = report_date.strftime("%Y-%m-%d")
        quarter = {3: "Q1", 6: "Q2", 9: "Q3", 12: "FY"}[report_date.month]
        row["REPORT_DATE"] = row["report_date"]
        row["START_DATE"] = f"{report_date.year}-01-01"
        reports.append(report_from_indicator_row(row, "CN", args.currency, "AkShare/EastMoney A-share earnings report"))
        if len(reports) >= args.limit:
            break
    if reports:
        reports[0]["sourceUrl"] = cninfo_url(symbol, reports[0]["fiscalYear"], reports[0]["fiscalQuarter"])
    return reports


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--company", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--market", required=True, choices=["HK", "US", "CN"])
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--hkex-code", default="")
    parser.add_argument("--currency", default="RMB", choices=["RMB", "USD", "HKD"])
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()

    if args.market == "HK":
        reports = fetch_hk(args)
    elif args.market == "US":
        reports = fetch_us(args)
    else:
        reports = fetch_cn(args)

    payload = {
        "ok": True,
        "provider": "akshare",
        "companyId": args.company,
        "companyName": args.name,
        "market": args.market,
        "ticker": args.ticker,
        "sourceTitle": "AkShare third-party financial indicators",
        "sourceUrl": reports[0].get("sourceUrl") if reports and reports[0].get("sourceUrl") else source_url(args),
        "reports": reports,
    }
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
