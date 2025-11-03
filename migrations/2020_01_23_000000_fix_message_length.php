<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Builder;

return [
    // [FIX] 使用原生 SQL 在 MySQL/MariaDB 下修改字段长度，避免对 DBAL 的依赖；
    //       其它驱动保留原来的 change() 作为兜底（Laravel 10 多数场景 change 已可无 DBAL）。
    'up' => function (Builder $schema) {
        $connection = $schema->getConnection();
        $prefix     = $connection->getTablePrefix();
        $driver     = $connection->getDriverName();

        if (in_array($driver, ['mysql', 'mariadb'])) {
            $connection->statement("ALTER TABLE `{$prefix}pushedx_messages` MODIFY `message` VARCHAR(1024)");
        } else {
            $schema->table('pushedx_messages', function (Blueprint $table) {
                $table->string('message', 1024)->change(); // [NOTE] 兜底：非 MySQL 系走 change()
            });
        }
    },

    'down' => function (Builder $schema) {
        $connection = $schema->getConnection();
        $prefix     = $connection->getTablePrefix();
        $driver     = $connection->getDriverName();

        if (in_array($driver, ['mysql', 'mariadb'])) {
            // 回退到初始迁移的默认长度 255
            $connection->statement("ALTER TABLE `{$prefix}pushedx_messages` MODIFY `message` VARCHAR(255)");
        } else {
            $schema->table('pushedx_messages', function (Blueprint $table) {
                $table->string('message')->change(); // 255
            });
        }
    },
];
