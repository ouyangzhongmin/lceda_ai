# Plugin 配置说明

## 环境配置文件

项目提供了三个预设的环境配置文件：

- `.env.development` - 开发环境配置
- `.env.test` - 测试环境配置  
- `.env.production` - 生产环境配置

## 使用方法

### 方式一：使用预设环境配置

根据需要复制对应的环境配置文件为 `.env`：

```bash
# 开发环境
cp .env.development .env

# 测试环境
cp .env.test .env

# 生产环境
cp .env.production .env
```

### 方式二：自定义配置

从示例文件创建自定义配置：

```bash
cp .env.example .env
```

然后编辑 `.env` 文件修改配置项。

## 构建说明

环境变量在构建时通过 esbuild 的 `define` 功能注入到代码中。

### 构建命令

```bash
# 使用默认环境（development）
npm run build

# 开发环境构建
npm run build:dev

# 测试环境构建
npm run build:test

# 生产环境构建
npm run build:prod
```

### 构建流程

1. 构建脚本根据 `NODE_ENV` 环境变量选择对应的 `.env.*` 文件
2. 如果没有找到对应文件，则尝试加载 `.env` 文件
3. 环境变量通过 esbuild 的 `define` 在编译时替换到代码中
4. 最终打包的 bundle 中包含编译时确定的配置值

### 优先级

环境变量的优先级（从高到低）：

1. 系统环境变量（`process.env`）
2. `.env.{NODE_ENV}` 文件
3. `.env` 文件
4. 代码中的默认值

## 配置项说明

### SERVER_BASE_URL

服务器基础 URL，用于所有 API 请求。

- 开发环境：`http://127.0.0.1:8080`
- 测试环境：`https://test-api.lceda.cn`
- 生产环境：`https://api.lceda.cn`

### PLUGIN_CHANNEL

插件渠道类型：

- `standard` - 标准版
- `professional` - 专业版

### NODE_ENV

运行环境模式：

- `development` - 开发环境
- `test` - 测试环境
- `production` - 生产环境

## 注意事项

1. `.env` 文件已被 `.gitignore` 忽略，不会提交到版本控制
2. 环境变量在构建时注入，修改配置后需要重新构建
3. 生产环境请确保使用正确的服务器地址
4. 可以通过系统环境变量覆盖 `.env` 文件中的配置：
   ```bash
   SERVER_BASE_URL=https://custom.api.com npm run build:prod
   ```
