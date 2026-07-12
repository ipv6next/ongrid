---
name: docker_container_ops
version: 1.0.0
description: Docker 容器只读巡检与故障诊断技能，用于查询容器状态、资源占用、日志、健康检查、重启次数、端口和镜像信息。
when_to_use: |
  当用户询问 Docker、容器、镜像、容器日志、容器健康状态、异常退出、
  重启次数、资源占用、端口映射或 Compose 服务状态时使用。
  本技能只执行查询。启动、停止、重启、删除、更新、扩缩容等变更操作
  不得通过本技能执行，应生成建议动作并进入人工确认。
metadata:
  os: [linux]
  requires:
    bins: [docker]
  ongrid:
    scope: edge
    edge_runtime: subprocess
    edge_capabilities:
      - process.exec: [docker]
    activation:
      mode: keyword
      keywords: [Docker, docker, 容器, 镜像, Compose, compose, container, image]
    min_ongrid_version: ">=0.7.30"
---

# 容器运维

使用目标设备上的 `host_bash` 对 Docker 进行只读巡检和故障诊断。

## 安全边界

- 只允许：`version`、`info`、`ps`、`inspect`、`logs`、`stats`、`top`、`port`、`images`、`network ls/inspect`、`volume ls/inspect`、`compose ps/logs/config/images/top`。
- 禁止：`run`、`exec`、`start`、`stop`、`restart`、`kill`、`rm`、`rmi`、`pull`、`push`、`build`、`create`、`update`、`cp`、`commit`、`rename`、`pause`、`unpause`、`network create/rm/connect/disconnect`、`volume create/rm/prune`、`system prune`、`compose up/down/start/stop/restart/pull/build`。
- 不读取或输出 Docker Registry 凭据、环境变量中的密码、Token、私钥和完整敏感挂载内容。
- 用户要求变更时，先输出影响范围、风险、回滚方法和建议动作，交由人工确认流程。

## 调用格式

调用现有工具：

```text
host_bash(device_id=<设备ID>, cmd="<单条 docker 只读命令>")
```

不要使用 `;`、`&&`、`||`、重定向、命令替换或 shell 包装。

## 诊断流程

1. 先确认 Docker 可用：

```text
docker version
docker info
```

2. 获取容器概况：

```text
docker ps -a --no-trunc
docker stats --no-stream
```

3. 对异常容器读取结构化状态：

```text
docker inspect <容器名或ID>
docker top <容器名或ID>
docker port <容器名或ID>
```

4. 按需读取有限日志，避免无界输出：

```text
docker logs --tail 200 --timestamps <容器名或ID>
docker logs --since 30m --tail 500 --timestamps <容器名或ID>
```

5. Compose 场景使用：

```text
docker compose ps -a
docker compose config --services
docker compose logs --tail 200 --timestamps <服务名>
```

## 重点判断

- `State.Status`、`State.Running`、`State.ExitCode`、`State.Error`
- `State.OOMKilled`、`State.Restarting`、`RestartCount`
- `State.Health.Status` 和最近健康检查输出
- CPU、内存、网络和块 IO 是否出现异常
- 端口映射、网络、挂载和镜像是否符合预期
- 日志中最近出现的 error、panic、OOM、timeout、connection refused

## 输出要求

按以下结构给出结论：

1. **概况**：运行、停止、异常容器数量。
2. **发现**：容器、证据、时间、严重级别。
3. **可能原因**：区分事实和推断，不把单条日志直接当作根因。
4. **建议动作**：只读复核优先；变更动作标注风险并要求人工确认。
5. **证据**：列出实际调用的命令和关键返回摘要，便于审计。

若 Docker 未安装、守护进程不可达或当前用户无 Docker Socket 权限，直接说明原因，不反复执行同一失败命令。
