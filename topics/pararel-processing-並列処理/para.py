from __future__ import annotations

if True:
    """
    擬似並列処理を実装。
    """
    import time
    from random import randint
    import sys
    import subprocess

    class IO:
        def __init__(self, path: str):
            self.path = path
        def dump_text(self, data: str, mode: str = "a"):
            with open(self.path, mode=mode, encoding="utf-8") as f:
                f.write("\n" + data)

    CODE = "para.py"
    OUTPUT_FILE = "output.yml"

    def main():
        plist = []
        for i in range(5):
            command = [sys.executable, CODE, f"process_{i}"]
            print(f"exec command : {command}")
            p = subprocess.Popen(command)   # Popenなら処理終了を待たずに次に行ってくれる。
            plist.append(p)
        
        for p in plist:
            p.wait()

    def submain(arg: str):
        io = IO(OUTPUT_FILE)
        sec = randint(1, 10) / 10 * 2
        info = f"{arg=} , {sec=}"
        io.dump_text(f"start : {info}")
        time.sleep(sec)
        io.dump_text(f"end   : {info}")

    if __name__ == "__main__":
        """
        引数なしでまずmainを実行し、
        main内で引数ありでsubmainを実行する。
        """
        if len(sys.argv) <= 1:
            main()
        else:
            submain(sys.argv[1])
    ...
