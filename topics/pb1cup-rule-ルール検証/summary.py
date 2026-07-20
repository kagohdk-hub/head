if True:
    from data_io import IO
    match_result_io = IO("./match_result.yml")
    pairs_io = IO("./pairs.yml")
    players_io = IO("./players.yml")

    # データロード
    matches = match_result_io.yaml_load()
    pairs = pairs_io.yaml_load()
    players = players_io.yaml_load()

    # match result を1つずつみていって、playersに戦績を書いていく
    def find_pair(pair_id: int, round_: int) -> dict:
        for p in pairs[round_]:
            if p["pair_id"] == pair_id:
                return p
        raise Exception(f"Pair not found : {pair_id=} , {round_=}")

    def find_player(num: int) -> dict:
        for p in players:
            if p["num"] == num:
                return p
        raise Exception(f"Player not found : {num=}")
        ...

    for player_ in players:
        player_["match_results"] = []

    for match_ in matches:
        point_total = sum(match_["point"])
        for i in range(2):
            pair = find_pair(match_["match_pair"][i], match_["round"])
            point_get = match_["point"][i]
            for j in range(2):
                player = find_player(pair["pair"][j])
                player["match_results"].append(
                    {
                        "round": match_["round"]
                        , "point_get": point_get
                        , "point_total": point_total
                    }
                )

    # players ごとに集計する
    for player in players:
        point_get_sum = 0
        point_total_sum = 0
        for match_result in player["match_results"]:
            point_get_sum += match_result["point_get"]
            point_total_sum += match_result["point_total"]
        player["summary"] = {
            "point_get_rate": round(point_get_sum / point_total_sum, 4)
            , "point_get": point_get_sum
            , "point_total": point_total_sum
        }
        ...

    # players で順位づけ（ソート）する。
    players = sorted(
        players
        , key=lambda x: x["summary"]["point_get_rate"]
        , reverse=True
    )
    players_io.yaml_dump(players)

    ...
