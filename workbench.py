"""Bedazzle entry point."""
import multiprocessing
import sys

if __name__ == '__main__':
    if sys.stdout is not None:
        sys.stdout.reconfigure(encoding='utf-8')
    if sys.stderr is not None:
        sys.stderr.reconfigure(encoding='utf-8')
    multiprocessing.freeze_support()
    from launcher import main
    raise SystemExit(main())
