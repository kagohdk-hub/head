if True:
    """
    イメージばピンボール。三角形に並べられたピンに上からボールを大量に流すと
    正規分布になるというもの
    """
    from random import randint
    from data_io import IO

    io_ = IO("./players.yml")

    # level_p_list = {
    #     i: 0
    #     for i in range(1, 101)
    # }

    players = []

    TOTAL_NUM = 32
    for num in range(TOTAL_NUM):

        # 9のレイヤーで50%の確率で上げ下げする まず正規分布的に10の区分に分ける
        partition = 4.5
        for layer in range(9):
            if randint(0, 1) == 1:  # up
                partition += 0.5
            else:   # down
                partition -= 0.5

        # さらにランダムに10の区分内で10レベルを分ける
        level = int((partition * 10) + randint(1, 10))

        # level_p_list[level] += 1
        players.append(
            {
                "num": num + 1
                , "level": level
            }
        )

    # 出力
    io_.yaml_dump(players)
