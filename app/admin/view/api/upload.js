define(['md5'], function (SparkMD5, allowExtsMimes) {
    allowExtsMimes = JSON.parse('{$exts|raw}');
    return function (element, UploadedHandler) {
        /*! 定义初始化变量 */
        var opt = {element: $(element)}, index;
        opt.safe = opt.element.data('safe') || '';
        opt.type = opt.element.data('type') || '';
        opt.field = opt.element.data('field') || 'file';
        opt.input = $('[name="_field_"]'.replace('_field_', opt.field));
        opt.uptype = opt.safe ? 'local' : opt.element.attr('data-uptype') || '';
        opt.multiple = opt.element.attr('data-multiple') > 0;
        /*! 文件的选择筛选 */
        this.mimes = [], this.exts = [], this.types = opt.type.split(',');
        for (index in this.types) if (allowExtsMimes[this.types[index]]) {
            this.exts.push(this.types[index]), this.mimes.push(allowExtsMimes[this.types[index]]);
        }
        /*! 调用初始化组件 */
        renderUploader({exts: this.exts.join('|'), acceptMime: this.mimes.join(',')});

        /*! 初始化上传组件 */
        function renderUploader(options, headers, uploader) {
            uploader = layui.upload.render({
                idx: 0, auto: false, headers: headers || {}, multiple: opt.multiple,
                accept: 'file', elem: element, exts: options.exts, acceptMime: options.acceptMime,
                choose: function (object, files) {
                    files = object.pushFile(), opt.element.data('files', files);
                    for (index in files) md5file(files[index]).then(function (file) {
                        opt.element.data('file', file).data('index', index);
                        jQuery.ajax("{:url('@admin/api.upload/state')}", {
                            data: {xkey: file.xkey, uptype: opt.uptype, safe: opt.safe, name: file.name}, method: 'post', success: function (ret) {
                                file.xurl = ret.data.url;
                                if (parseInt(ret.code) === 404) {
                                    uploader.config.url = ret.data.server;
                                    uploader.config.data.key = ret.data.xkey;
                                    uploader.config.data.safe = ret.data.safe;
                                    uploader.config.data.uptype = ret.data.uptype;
                                    if (ret.data.uptype === 'qiniu') {
                                        uploader.config.data.token = ret.data.token;
                                    } else if (ret.data.uptype === 'alioss') {
                                        uploader.config.data.policy = ret.data.policy;
                                        uploader.config.data.signature = ret.data.signature;
                                        uploader.config.data.OSSAccessKeyId = ret.data.OSSAccessKeyId;
                                        uploader.config.data.success_action_status = 200;
                                        uploader.config.data['Content-Disposition'] = 'inline;filename=' + encodeURIComponent(file.name);
                                    }
                                    object.upload(index, file);
                                } else if (parseInt(ret.code) === 200) {
                                    UploadedHandler.call(opt.element, file.xurl, file);
                                } else {
                                    $.msg.error(ret.info || ret.error.message || '文件上传出错！');
                                }
                            }
                        });
                        delete files[index];
                    });
                },
                before: function () {
                    this.idx = $.msg.loading('上传进度 <span data-upload-progress>0%</span>');
                },
                progress: function (n) {
                    $('[data-upload-progress]').html(n + '%');
                },
                done: function (ret, file) {
                    file = opt.element.data('file');
                    this.multiple || $.msg.close(this.idx);
                    if (typeof ret.uploaded === 'undefined' && file.xurl) {
                        ret = {uploaded: true, url: file.xurl};
                    }
                    if (ret.uploaded) {
                        if (typeof UploadedHandler === 'function') {
                            UploadedHandler.call(opt.element, ret.url, file);
                        } else {
                            opt.input.val(ret.url).trigger('change');
                        }
                    } else {
                        $.msg.error(ret.info || ret.error.message || '文件上传出错！');
                    }
                },
                allDone: function () {
                    $.msg.close(this.idx), opt.element.html(opt.element.data('html'));
                }
            });
        };
    };

    function md5file(file) {
        var deferred = jQuery.Deferred();
        file.xext = file.name.indexOf('.') > -1 ? file.name.split('.').pop() : 'tmp';
        /*! 兼容不能计算文件 HASH 的情况 */
        if (!window.FileReader) return jQuery.when((function (date, chars) {
            date = new Date(), chars = 'abcdefhijkmnprstwxyz0123456789';
            this.xmd5 = '' + date.getFullYear() + (date.getMonth() + 1) + date.getDay() + date.getHours() + date.getMinutes() + date.getSeconds();
            while (this.xmd5.length < 32) this.xmd5 += chars.charAt(Math.floor(Math.random() * chars.length));
            setFileXdata(file, this.xmd5);
            deferred.resolve(file, file.xmd5, file.xkey);
            return deferred;
        }).call(this));
        /*! 读取文件并计算 HASH 值 */
        var spark = new SparkMD5.ArrayBuffer();
        var slice = File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice;
        file.chunk_idx = 0, file.chunk_size = 2097152;
        file.chunk_total = Math.ceil(this.size / this.chunk_size);
        return jQuery.when(loadNextChunk(file));

        function setFileXdata(file, xmd5) {
            file.xmd5 = xmd5;
            file.xkey = file.xmd5.substr(0, 2) + '/' + file.xmd5.substr(2, 30) + '.' + file.xext;
            delete file.chunk_idx;
            delete file.chunk_size;
            delete file.chunk_total;
            return file;
        }

        function loadNextChunk(file) {
            this.reader = new FileReader();
            this.reader.onload = function (e) {
                spark.append(e.target.result);
                if (++file.chunk_idx < file.chunk_total) {
                    loadNextChunk(file);
                } else {
                    setFileXdata(file, spark.end());
                    deferred.resolve(file, file.xmd5, file.xkey);
                }
            };
            this.reader.onerror = function () {
                deferred.reject();
            };
            this.start = file.chunk_idx * file.chunk_size;
            this.loaded = ((this.start + file.chunk_size) >= file.size) ? file.size : this.start + file.chunk_size;
            this.reader.readAsArrayBuffer(slice.call(file, this.start, this.loaded));
            deferred.notify(file, (this.loaded / file.size * 100).toFixed(2));
            return deferred;
        }
    }
});