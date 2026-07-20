if True:
    # standard
    from pathlib import Path
    import json
    # installed
    from ruamel.yaml import YAML
    import pandas as pd
    # custom

    # ファイル入出力初期設定
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.indent(mapping=2, sequence=4, offset=2)
    class IO:
        def __init__(self, path: str | Path) -> list | dict:
            self.path: str | Path = path

        def text_load(self, mode: str = "r", encoding: str = "utf-8") -> str:
            with open(self.path, mode=mode, encoding=encoding) as f:
                return f.read()
        
        def text_dump(self, data: str) -> None:
            with open(  self.path
                        , mode="w", encoding="utf-8") as f:
                return f.write(data)

        def json_load(self) -> dict | list:
            with open(self.path, mode="r", encoding="utf-8") as f:
                return json.load(f)

        def json_dump(self, data: list | dict) -> None:
            with open(self.path, mode="w", encoding="utf-8") as f:
                json.dump(data, f)
        def yaml_load(self) -> dict | list:
            with open(self.path, mode="r", encoding="utf-8") as f:
                return yaml.load(f)

        def yaml_dump(self, data: list | dict) -> None:
            with open(self.path, mode="w", encoding="utf-8") as f:
                yaml.dump(data, f)

        def csv_load(self, mode: str = "r", encoding: str = "utf-8"
                    , type_df_flg: bool = False) -> list[dict] | pd.DataFrame:
            with open(self.path, mode=mode, encoding=encoding) as f:
                df = pd.read_csv(f)

            if type_df_flg:
                return df
            else:
                return df.to_dict(orient="records")

        def csv_dump(self, data: list[dict], encoding: str = "utf-8") -> None:
            df_data = pd.DataFrame.from_records(data)
            df_data.to_csv(self.path, sep=",", index=False, encoding=encoding)

        def excel_load(self, to_dict_flag=True) -> list[dict] | pd.DataFrame:
            df = pd.read_excel(self.path, index_col=None)
            if to_dict_flag:
                return df.to_dict(orient="records")
            else:
                return df

        def excel_dump(self, data: list[dict] | pd.DataFrame
                        , mode="w", sheet_name="Sheet1") -> None:
            if type(data) != pd.DataFrame:
                data = pd.DataFrame.from_records(data)

            option={}
            if mode == "a":
                option = {"if_sheet_exists": "overlay"}
            with pd.ExcelWriter(self.path, mode=mode, **option) as f:
                data.to_excel(f, sheet_name=sheet_name)
