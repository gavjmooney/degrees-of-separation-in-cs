"""Pipeline entry point: python -m dblp_pipeline.cli <stage> [options]

Stages:
    parse      dblp.xml.gz -> staging.sqlite          (slow, once per dump)
    build      staging.sqlite -> artifacts/            (minutes, iterable)
    validate   check artifact invariants
"""

import sys

from . import build, layout, parse, validate

STAGES = {
    "parse": parse.main,
    "build": build.main,
    "validate": validate.main,
    "layout": layout.main,
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in STAGES:
        print(__doc__)
        sys.exit(1)
    STAGES[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    main()
