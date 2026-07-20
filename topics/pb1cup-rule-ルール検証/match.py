if True:
    from data_io import IO
    from random import shuffle

    players_io = IO("./players.yml")
    pairs_io = IO("./pairs.yml")
    match_result_io = IO("./match_result.yml")

    from dataclasses import dataclass
    @dataclass
    class Player:
        num: int
        level: int
        pair_num: dict = None
        def __post_init__(self):
            self.pair_num = {
                1: None
                , 2: None
                , 3: None
                , 4: None
                , 5: None
            }

        def can_set_pair(self, num: int, round_: int):
            if num == self.num:
                return False
            if self.pair_num[round_] is not None:
                return False
            return bool(
                num not in self.pair_num.values()
            )

    players = [
        Player(**player)
        for player in players_io.yaml_load()
    ]
    def find_player(num: int) -> Player:
        for player in players:
            if player.num == num:
                return player
        raise Exception(f"Player not found : {num}")

    # 5順する
    ROUND_NUM = 5
    pairs = {   round_: []
                for round_ in range(1, ROUND_NUM + 1)}
    pair_id = 0
    for num in range(1, len(players)+1):
        player = find_player(num)

        for round_ in range(1, ROUND_NUM + 1):
            # ペアを作る
            if player.pair_num[round_] is not None:
                continue

            pair_kouho_list = [
                pair_kouho
                for pair_kouho in players
                if pair_kouho.can_set_pair(num, round_)
                ]
            print(f"{num=}")
            if not pair_kouho_list:
                print(f"{num=}")
                l = [p for p in players
                     if p.pair_num[round_] is None]
                print(l)
            shuffle(pair_kouho_list)
            pair_player = pair_kouho_list[0]
            pair_id += 1
            pairs[round_].append(
                {
                    "pair_id": pair_id
                    , "opponent_pair_id": None
                    , "pair": sorted([num, pair_player.num])
                }
            )
            player.pair_num[round_] = pair_player.num
            pair_player.pair_num[round_] = num

    pairs_io.yaml_dump(pairs)

    def find_pairs(pair_id: int, round_: int) -> dict:
        for p in pairs[round_]:
            if p["pair_id"] == pair_id:
                return p
        raise Exception(f"Pair not found : {pair_id=} , {round_=}")

    def result_culc(match_info: dict):
        pair1 = find_pairs(match_info["match_pair"][0], match_info["round"])
        pair2 = find_pairs(match_info["match_pair"][1], match_info["round"])

        pair1_player1 = find_player(pair1["pair"][0])
        pair1_player2 = find_player(pair1["pair"][1])
        pair2_player1 = find_player(pair2["pair"][0])
        pair2_player2 = find_player(pair2["pair"][1])

        pair1_level = pair1_player1.level + pair1_player2.level
        pair2_level = pair2_player1.level + pair2_player2.level

        if pair1_level > pair2_level:
            pair1_point = 11
            pair2_point = int(11 * (pair2_level / pair1_level))
        else:
            pair2_point = 11
            pair1_point = int(11 * (pair1_level / pair2_level))
        match_info["point"] = [pair1_point, pair2_point]
        ...

    # ペア間のマッチを作る
    matches = []
    for round_ in range(1, ROUND_NUM + 1):
        print(f"{num=} , {round_=} , {len(pairs[round_])=}")
        for pair in pairs[round_]:

            # マッチを作る
            if pair["opponent_pair_id"] is not None:
                continue

            oppornent_pair_kouho_list = [
                op_pair
                for op_pair in pairs[round_]
                if op_pair["opponent_pair_id"] is None
                and pair["pair_id"] != op_pair["pair_id"]
            ]
            shuffle(oppornent_pair_kouho_list)
            oppornent_pair = oppornent_pair_kouho_list[0]

            pair["opponent_pair_id"] = oppornent_pair["pair_id"]
            oppornent_pair["opponent_pair_id"] = pair["pair_id"]
            match_info = {
                "round": round_
                , "match_pair": sorted([pair["pair_id"], oppornent_pair["pair_id"]])
            }

            # 結果を入力する
            result_culc(match_info)

            matches.append(match_info)
        ...

    # 結果を出力する
    match_result_io.yaml_dump(matches)
