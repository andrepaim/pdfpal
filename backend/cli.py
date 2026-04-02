import argparse
import os

def main():
    parser = argparse.ArgumentParser(description="pdfpal — PDF research assistant")
    parser.add_argument("--db", default=None, help="Path to SQLite database file")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host")
    parser.add_argument("--port", type=int, default=8200, help="Bind port")
    args = parser.parse_args()

    if args.db:
        os.environ["PDFPAL_DB"] = str(args.db)

    import uvicorn
    uvicorn.run("main:app", host=args.host, port=args.port)

if __name__ == "__main__":
    main()
