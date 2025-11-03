<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Builder;

return [
    'up' => function (Builder $schema) {
        // --- 重命名主表 ------------------------------------------------------
        // [HARDEN] 仅当旧表存在且新表不存在时才重命名，避免重复执行报错
        if ($schema->hasTable('pushedx_messages') && !$schema->hasTable('neonchat_messages')) {
            $schema->rename('pushedx_messages', 'neonchat_messages');
        }

        // --- 创建 chats 主表 ---------------------------------------------------
        if (!$schema->hasTable('neonchat_chats')) {
            $schema->create('neonchat_chats', function (Blueprint $table) {
                $table->increments('id');
                $table->string('title', 100)->default('PM');
                $table->string('color', 20)->nullable();
                $table->string('icon', 100)->nullable();
                $table->tinyInteger('type')->default(0);
                $table->integer('creator_id')->unsigned()->default(0);
                $table->dateTime('created_at')->nullable();
            });

            // 预置一个默认频道
            $db = $schema->getConnection();
            $db->table('neonchat_chats')->insert([
                'title' => '#main',
                'color' => '#FF94C1',
                'icon'  => 'fas fa-cloud',
                'type'  => 1,
            ]);
        }

        // --- 创建 pivot 表 -----------------------------------------------------
        if (!$schema->hasTable('neonchat_chat_user')) {
            $schema->create('neonchat_chat_user', function (Blueprint $table) {
                $table->integer('chat_id')->unsigned();
                $table->integer('user_id')->unsigned();

                $table->primary(['chat_id', 'user_id']);

                $table->foreign('chat_id')->references('id')->on('neonchat_chats')->onDelete('cascade');
                $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            });
        }

        // --- 修改 neonchat_messages 结构 --------------------------------------
        // 1) 把 actorId -> user_id（避开 renameColumn 对 DBAL 的依赖）
        $connection = $schema->getConnection();
        $prefix     = $connection->getTablePrefix();
        $driver     = $connection->getDriverName();

        if ($schema->hasTable('neonchat_messages')) {
            if ($schema->hasColumn('neonchat_messages', 'actorId') && !$schema->hasColumn('neonchat_messages', 'user_id')) {
                if (in_array($driver, ['mysql', 'mariadb'])) {
                    // [FIX] MySQL/MariaDB 用原生 CHANGE 改名与类型（按旧表定义：INT UNSIGNED NULL）
                    $connection->statement("ALTER TABLE `{$prefix}neonchat_messages` CHANGE `actorId` `user_id` INT UNSIGNED NULL");
                } else {
                    // [HARDEN] 兜底：新列 + 数据迁移 + 删旧列
                    $schema->table('neonchat_messages', function (Blueprint $table) {
                        $table->integer('user_id')->unsigned()->nullable();
                    });
                    $connection->statement("UPDATE `{$prefix}neonchat_messages` SET `user_id` = `actorId`");
                    $schema->table('neonchat_messages', function (Blueprint $table) {
                        $table->dropColumn('actorId');
                    });
                }
            }

            // 2) 补充所需列与外键
            $schema->table('neonchat_messages', function (Blueprint $table) use ($schema) {
                if (!$schema->hasColumn('neonchat_messages', 'chat_id')) {
                    $table->integer('chat_id')->unsigned()->default(1);
                }
                if (!$schema->hasColumn('neonchat_messages', 'type')) {
                    $table->tinyInteger('type')->default(0);
                }
                if (!$schema->hasColumn('neonchat_messages', 'is_readed')) {
                    $table->boolean('is_readed')->default(0);
                }
                if (!$schema->hasColumn('neonchat_messages', 'ip_address')) {
                    $table->string('ip_address', 45)->nullable();
                }

                // 外键（存在即跳过，Laravel 会根据列名生成约束名）
                $table->foreign('chat_id')->references('id')->on('neonchat_chats')->onDelete('cascade');
                $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
                if ($schema->hasColumn('neonchat_messages', 'deleted_by')) {
                    $table->foreign('deleted_by')->references('id')->on('users')->onDelete('cascade');
                }
            });
        }
    },

    'down' => function (Builder $schema) {
        // 回滚 neonchat_messages 的外键与新增列
        if ($schema->hasTable('neonchat_messages')) {
            $schema->table('neonchat_messages', function (Blueprint $table) {
                // [HARDEN] 按列名删除外键（自动解析约束名）
                if (method_exists($table, 'dropForeign')) {
                    try { $table->dropForeign(['chat_id']); } catch (\Throwable $e) {}
                    try { $table->dropForeign(['user_id']); } catch (\Throwable $e) {}
                    try { $table->dropForeign(['deleted_by']); } catch (\Throwable $e) {}
                }
            });

            // 删除新增列
            $schema->table('neonchat_messages', function (Blueprint $table) use ($schema) {
                $cols = ['chat_id', 'type', 'is_readed', 'ip_address'];
                foreach ($cols as $c) {
                    if ($schema->hasColumn('neonchat_messages', $c)) {
                        $table->dropColumn($c);
                    }
                }
            });

            // 把 user_id -> actorId（仍旧避免 DBAL 依赖）
            $connection = $schema->getConnection();
            $prefix     = $connection->getTablePrefix();
            $driver     = $connection->getDriverName();

            if ($schema->hasColumn('neonchat_messages', 'user_id') && !$schema->hasColumn('neonchat_messages', 'actorId')) {
                if (in_array($driver, ['mysql', 'mariadb'])) {
                    $connection->statement("ALTER TABLE `{$prefix}neonchat_messages` CHANGE `user_id` `actorId` INT UNSIGNED NULL");
                } else {
                    // 兜底：新建 + 回填 + 删除
                    $schema->table('neonchat_messages', function (Blueprint $table) {
                        $table->integer('actorId')->unsigned()->nullable();
                    });
                    $connection->statement("UPDATE `{$prefix}neonchat_messages` SET `actorId` = `user_id`");
                    $schema->table('neonchat_messages', function (Blueprint $table) {
                        $table->dropColumn('user_id');
                    });
                }
            }
        }

        // 删 pivot 与 chats
        if ($schema->hasTable('neonchat_chat_user')) {
            // 先去外键再删表
            $schema->table('neonchat_chat_user', function (Blueprint $table) {
                if (method_exists($table, 'dropForeign')) {
                    try { $table->dropForeign(['chat_id']); } catch (\Throwable $e) {}
                    try { $table->dropForeign(['user_id']); } catch (\Throwable $e) {}
                    try { $table->dropForeign(['removed_by']); } catch (\Throwable $e) {}
                }
            });
            $schema->drop('neonchat_chat_user');
        }

        if ($schema->hasTable('neonchat_chats')) {
            $schema->drop('neonchat_chats');
        }

        // 表名回滚
        if ($schema->hasTable('neonchat_messages') && !$schema->hasTable('pushedx_messages')) {
            $schema->rename('neonchat_messages', 'pushedx_messages');
        }
    },
];
