if True:
    from dataclasses import dataclass
    from __future__ import annotations

    class 選挙制度:
        @dataclass
        class 票:
            ...

        def __init__(self):
            self.投票箱: list[選挙制度.票] = []
            self.立候補者list = []
        def 立候補受付(self, 候補者):
            self.立候補者list.append(候補者)
        def 投票(self, RCV票: 選挙制度.票):
            self.投票箱.append(RCV票)
        def 開票(self):
            ...

    """
    従来型：候補者を一人だけ選択する
    """
    class 従来型選挙制度(選挙制度):
        def 開票(self):
            ...

    """
    全ての候補者に優先順位をつける
    """
    class RCV選挙制度(選挙制度):
        def 開票(self):
            RETRY_COUNT = 100
            落選候補者 = []
            for _ in RETRY_COUNT:
                開票結果 = {候補者_: 0 for 候補者_ in self.候補者list}

                for 票_ in self.投票箱:
                    票_: RCV選挙制度.票
                    try:
                        開票結果[票_.selected] += 1
                    except:
                        ...

                if max(開票結果.values()) > len(self.投票箱) / 2:   # 過半数なら
                    break
                else:
                    (最下位_候補, 最下位_票数) = (None, None)
                    for 結果_候補者, 結果_票数 in 開票結果:
                        if 最下位_票数 is None:
                            (最下位_候補, 最下位_票数) = (結果_候補者, 結果_票数)
                            continue
                        if 結果_票数 < 最下位_票数:
                            (最下位_候補, 最下位_票数) = (結果_候補者, 結果_票数)
                    落選候補者.append(最下位_候補)

                    for 票_ in self.投票箱:
                        if 票_.selected == 最下位_候補:
                            票_.次の順位を採用()

            self.開票結果 = 開票結果

        @dataclass
        class 票:
            selected: str = None
            優先順位list: list[str] = None
            有効順位: int = 0

            def __post_init__(self):
                self.優先順位list = []

            def 次の順位を採用(self):
                self.有効順位 += 1
                self.selected = self.優先順位[self.有効順位]

        """
        検証したいこと:
            - 2位票だけが大量にある人が1位票がそこそこある人より優遇されないか
            - 2馬力選挙に耐性はあるか
            - 政党は大量候補を出した方が良いか、少数候補に絞った方が良いか
        """
        def test(self):
            票_ = self.票()
            self.投票(票_)
