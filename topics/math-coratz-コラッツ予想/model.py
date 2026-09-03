"""
    コラッツ予想
    どんな正の整数に対しても、
    偶数なら2で割る、奇数なら3倍して1を足す
    を繰り返すと必ず最終的に1になる
"""
"""
    証明アイディア
    ・1から逆算
    ・関数グラフ化
"""
from typing import List
from dataclasses import dataclass

from lib import data_handler as dh
from lib.data_io import inputio, outputio

LOOP_MAX = 1000


class Corats:
    def reverse_culc(self, num) -> List[int]:
        res = []

        res.append(num * 2)

        if dh.Int.is_int((num - 1) / 3):
            res.append((num - 1 / 3))

        return res

    def culc(self, num: int) -> int:
        if num % 2 == 0:
            return num / 2
        else:
            return num * 3 + 1

    def main(self, num):
        print("-- {}".format(num))
        for _ in range(LOOP_MAX):
            if dh.Int.is_int(num) is False or num <= 0:
                raise Exception("InvalidArgument")

            res = self.culc(num)
            print(res)

            if res == 1:
                return res
            num = res
        else:
            raise Exception("CulcOver")

    def check(self):
        for num in range(1, 1000):
            res = self.main(num)
            if res != 1:
                raise Exception("DifferenceAnswer")

    def check_1(self):
        self.main(27)


@dataclass
class Data:
    n: int
    odd: int
    i: int
    devide_count: int


def make_data_list(init_num: int):
    input_data = inputio.yaml.load()
    res = []
    n = 0
    devide_count = 0
    for num in input_data[init_num]:
        if dh.Int.is_even(num) is False:
            odd = num
            i = int((odd - 1) / 2)
            res.append(
                Data(n, odd, i, devide_count).__dict__
            )

            devide_count = 0
            n += 1
        else:
            devide_count += 1
    outputio.yaml.dump(res)


if __name__ == "__main__":
    Corats().check()
