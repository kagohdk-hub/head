from __future__ import annotations

if True:
    """
    擬似並列処理を実装。
    15分で遊ぶぞ    という小学校の思い出
    """
    import time
    from random import randint
    import sys
    import subprocess

    class IO:
        def __init__(self, path: str):
            self.path = path
        def load_text(self) -> str:
            with open(self.path, mode="r", encoding="utf-8") as f:
                return f.read()
        def dump_text(self, data: str, mode: str = "a"):
            with open(self.path, mode=mode, encoding="utf-8") as f:
                f.write("\n" + data)

    CODE = "nakayasumi.py"
    OUTPUT_FILE = "output.yml"
    io = IO(OUTPUT_FILE)

    def main():
        plist = []
        member = ["たろう", "じろう", "ゆうた", "たかし", "こうき"]
        for i in range(5):
            command = [sys.executable, CODE, f"{member[i]}"]
            if i == 0:
                command.append("ボール係")
            print(f"exec command : {command}")
            p = subprocess.Popen(command)   # Popenなら処理終了を待たずに次に行ってくれる。
            plist.append(p)
        
        for p in plist:
            p.wait()

    def submain(name, ボール係=None, *args):
        print(f"{name=} : {ボール係}")
        ボールとってきたよ = "ボールとってきたよ"
        コート引いたよ = "コート引いたよ"
        if ボール係:
            io.dump_text(f"{name} : 職員室にボールをとりにいく")
            time.sleep(0.5)
            io.dump_text(f"{name} : 校庭に走る")
            time.sleep(0.5)
            io.dump_text(f"{name} : {ボールとってきたよ}")
        else:
            io.dump_text(f"{name} : 校庭に走る")
            time.sleep(0.5)
            io.dump_text(f"{name} : 中当ての線を足で引く")
            time.sleep(1)
            io.dump_text(f"{name} : {コート引いたよ}")

        for _ in range(10):
            output = io.load_text()
            if (ボールとってきたよ in output) and (コート引いたよ in output):
                io.dump_text(f"{name} : 準備完了！中当て開始！！")
                break
            time.sleep(0.1)
        else:
            io.dump_text(f"{name} : 時間切れ")
            return

    if __name__ == "__main__":
        """
        引数なしでまずmainを実行し、
        main内で引数ありでsubmainを実行する。
        """
        if len(sys.argv) <= 1:
            main()
        else:
            submain(*sys.argv[1:])
    ...
