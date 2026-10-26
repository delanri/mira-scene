# 测试用临时数据库和临时图片目录（要在导入 server / store / imagegen 之前设好），不会写进项目里的 data/ 和 static/generated/
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="mira-test-")
os.environ["MIRA_DB_PATH"] = os.path.join(_tmp, "test.db")
os.environ["MIRA_GENERATED_DIR"] = os.path.join(_tmp, "generated")
# 测试默认不生图，需要时在测试里单独打开
os.environ["IMAGE_PROVIDER"] = "none"
