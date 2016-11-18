function EditorController(view, options){
  this.editor_view = ace.edit("editor");
  this.$ = $('#'+view);
  this.$editor = this.$.find('#editor')
  this.file_id = options["file_id"];
  
  this.ajax_defered_waiting = {}
  this.safe_to_quit = true;
  
  this.content = null;
  this.content_saved = "";

  this.word_wrap_pref = options["word_wrap_pref"]
  this.tab_size_pref = options["tab_size_pref"]
  this.major_notice_pref = options["major_notice_pref"]

  this.theme_pref = options["theme_pref"]

  this.file_explorer = options["file_explorer"]
  this.favorites_controller = options["favorites_controller"]

  this.menu_width_pref = options["menu_width_pref"]

  this.keybinding_pref = options["keybinding_pref"]

  this.flash = options["flash"]

  this.models = {
    'extensions':new RestAdapter({model:Extension}),
    'mime_types':new RestAdapter({model:MimeType}),
    'syntaxes':new RestAdapter({model:Syntax}),
  }

  this.autosave_interval;

  this.initialize_html();

  this.detect_device();
}

EditorController.prototype.initialize_html = function(){
  var self = this;

  self.$editor.css('top', self.$.find('#menu').height() + "px");
  $(window).resize(function(){
    self.$editor.css('top', self.$.find('#menu').height() + "px");
  })

  self.fontSizeWidget = new FontSizeWidget({widget_class:'font-size-selection', editor_controller:self});
  self.autosaveWidget = new AutosaveWidget({widget_class:'autosave-setting', editor_controller:self});

  $('.word_wrap_checkbox').on('change', function(){
    self.change_word_wrap($(this).prop('checked'));
    $('.word_wrap_checkbox').prop('checked', $(this).prop('checked'))
  });

  $('select').on('change', function() {
    if($(this).hasClass('keybinding_select')){
      self.change_keybinding(this.value);
    }
    else if($(this).hasClass('tab_size_select')){
      self.change_tab_size(this.value);
    }
  });

  $(window).bind('beforeunload',function(){
    if(!self.safe_to_quit || (self.file && self.file.did_content_change()) ){
      return i18n("You have unsaved changes or your file is still being saved. You will lose your changes")
    }
  });

  if(this.tab_size_pref.getValue() != null){
    this.editor_view.getSession().setTabSize(this.tab_size_pref.getValue())
  }

  this.change_keybinding(this.keybinding_pref.getValue())

  this.editor_view.getSession().setUseWrapMode(this.word_wrap_pref.getValue())

  $(window).on('keyup.ctrl-keys keydown.ctrl-keys', function(event){
    if(event.ctrlKey && event.which != 17) {
      switch(String.fromCharCode(event.which).toLowerCase()) {
        case 'p':
          self.print();
        case 'c':
          return true;
        case 'x':
          return true;
        case 'v':
          return true;
      }
      event.preventDefault();
      return false;
    }
  });

  this.initial_theme = "ace/theme/chrome"
  if(this.theme_pref.getValue()){
    this.initial_theme = this.theme_pref.getValue()
  }
  this.editor_view.setTheme(this.initial_theme)
  $("."+escape_jquery_selector("theme_"+this.initial_theme)).addClass("btn-primary")

  if(!BooleanPreference.find('agree_terms').getValue()){
    $("#terms_modal").modal({'show':true,backdrop: true,backdrop: 'static', keyboard:false});
    $('.modal-backdrop.fade.in').css('opacity', '1.0')
    $('#agree_terms').click(function(){
      $("#terms_modal").modal('hide')
      BooleanPreference.find("agree_terms").refreshAndSet(true, self, self.show_reauth)
    })
    $('#disagree_terms').click(function(){
      window.location.href = "http://www.google.com"
    })
  }

  if(self.major_notice_pref.getValue() < parseInt($('#major_notice_modal').attr('data-version')) ){
    $('#major_notice_modal').modal('show');
    $('.agree_major_notice').click(function(){
      $('#major_notice_modal').modal('hide'); 
      self.major_notice_pref.refreshAndSet(parseInt($('#major_notice_modal').attr('data-version')), self, self.show_reauth)
    })
  }

}



EditorController.prototype.post_app_load = function(){
  var self = this
  this.$.find("#app_load_modal").modal('hide');
  this.$.find("#loading_overlay").fadeOut();
}

EditorController.prototype.file_object_from_provider = function(args){
  var self = this;
  switch(this.provider) {
    case "GoogleDrive":
      return new DriveFile(args);
      break;
    case "Dropbox":
      return new DropboxFile(args);
      break;
  }
}

EditorController.prototype.new = function(folder_id){
  var self = this;

  // we stop the collaboration if it's there
  this.stop_collaboration();

  var create_new = function() {
    // Should always be able to edit the title of a new file
    $('input[data-bind-file="title"]').removeAttr('disabled');

    self.flash.empty()
    self.file = self.file_object_from_provider({
      uid : "file",
      folder_id : folder_id,
    })
    self.post_file_load()
    self.set_syntax_mode(self.file.syntax.ace_js_mode, false);
  }

  if(this.provider == "Dropbox"){
    dropbox_oauth_controller.test(create_new)
  }
  else {
    create_new();
  }

}

EditorController.prototype.edit = function(id){
  var self = this
  this.flash.empty()
  this.$.find("#file_load_modal").modal('show');
  this.file_id = id
  // we stop the collaboration if it's there
  this.stop_collaboration();
  this.file = self.file_object_from_provider({
    id:id,
    uid : "file",
    loaded : function(error){
      self.$.find("#file_load_modal").modal('hide');
      if(!error){
        if(this.provider == "GoogleDrive") {
          self.make_collaborative()
        }

        // Can't change filename with Dropbox
        if(this.provider == "Dropbox"){
          $('input[data-bind-file="title"]').attr('disabled', 'disabled');
        }
        else {
          $('input[data-bind-file="title"]').removeAttr('disabled');
        }

        self.post_file_load()
      }
      else{
        self.new("root")
        self.flash.error(error)
      }
    }
  })
}

EditorController.prototype.post_file_load = function(){
  var self = this;
  this.editor_view.getSession().setValue(this.file.data, -1)

  var new_data = this.editor_view.getSession().getValue();
  if(this.file.data != new_data){
    this.flash.warning(i18n("This file has an unknown encoding.<br/>Some characters may be corrupted and the file may lose parts of it's encoding when saved.<br/>Autosave has been temporarly disabled."))
    this.deactivate_autosave();
  }
  else {
    this.activate_autosave()
  }

  clearInterval(this.check_content_changed_interval)
  this.check_content_changed_interval = setInterval(function(){self.check_content_changed()}, 100)
  this.set_syntax_mode(this.file.syntax.ace_js_mode, false);
  this.allow_saving()

  if(this.file.persisted){
    this.flash.success(i18n("File loaded"), 3)
    document.title = this.file.title + " | Anyfile Notepad";
  }
  else{
    this.flash.success(i18n("Creating new file in: "+this.file.provider))
    document.title = i18n("New file")+" | Anyfile Notepad";
  }

  self.top_menu.close_mobile_menu();
}

EditorController.prototype.reset_options = function(){
  var self = this;
  this.allow_saving();
}

EditorController.prototype.print = function(){
  var myWindow = window.open("", "MsgWindow", "width=800, height=600");
  var lines = this.editor_view.getValue().split('\n');
  for(var i in lines){
    lines[i] = (parseInt(i)+1)+". "+lines[i];
  }
  var numbered_text = lines.join('\n');
  $('#print_content .with_line_numbers').text(numbered_text);
  $('#print_content .without_line_numbers').text(this.editor_view.getValue());
  myWindow.document.write("<script src='https://code.jquery.com/jquery-1.11.3.min.js'></script>");
  myWindow.document.write($('#print_content').html());
}

EditorController.prototype.save = function(){
  var self = this;
  if(!self.can_save){
    this.flash.warning(i18n("This file is already being saved. Calm down."), 5);
    return;
  }
  this.block_saving()
  var length = this.editor_view.getValue().length
  self.editor_view.focus()
  if(this.file.title == ""){
      this.flash.error(i18n("Filename can't be empty"), 5);
      self.allow_saving()
      return false
  }
  else{
    this.file.set("data", this.editor_view.getValue())

    // give a small time for everything to show.
    setTimeout(function(){
        self.file.update(true, function(response){
          if(response && !response.error) window.location.hash="#edit/"+self.provider+"/"+self.file.id
          self.editor_view.focus();
          self.allow_saving()
        })
    }, 500)
  }
  return false;
}

EditorController.prototype.activate_autosave = function(force){
  var self = this
  this.deactivate_autosave()
  if(force || BooleanPreference.find("autosave").getValue()) {
    $('.autosave-on').show();
    $('.autosave-off').hide();
    self.autosave_interval = setInterval(function(){self.autosave()}, 5000)
  }
}

EditorController.prototype.deactivate_autosave = function(){
  var self = this
  clearInterval(this.autosave_interval)
  $('.autosave-off').show();
  $('.autosave-on').hide();
}

EditorController.prototype.autosave = function(){
  var self = this;
  if(!this.file.title == "" && this.file.persisted && this.file.did_content_change()){
    this.file.set("data", this.editor_view.getValue())

    if(!self.autosave_count) self.autosave_count = 0;
    self.autosave_count += 1;

    this.$.find('.editor_save_button').html(i18n("Saving")+"...")
    var new_revision = (self.autosave_count % 3 == 0) ? true : false;

    self.file.update(new_revision, function(response){
      self.reset_options()
      if(response && !response.error) window.location.hash="#edit/"+self.provider+"/"+self.file.id
    })

  }
}

EditorController.prototype.set_syntax_mode = function(syntax,save){
  var self = this;
  save = save || false
  this.$.find('.syntax_button').css("background-color", "initial")
  var primary_color = $("<div>").appendTo("body").addClass("btn-primary").css("background-color");
  this.$.find('.syntax_'+syntax).css("background-color", primary_color);
  this.file.syntax = syntaxes.find({key:'ace_js_mode', value:syntax})
  this.editor_view.getSession().setMode("ace/mode/"+syntax);
  if(this.file_id != "" && save){
    StringPreference.find("syntaxes["+self.file.extension()+"]").refreshAndSet(syntax, self, self.show_reauth)
  }
}

EditorController.prototype.is_ready_to_submit = function(){
  var self = this;
  for(key in this.ajax_defered_waiting){
    if(this.ajax_defered_waiting[key]){
      return false
    }
  }
  return true
}

EditorController.prototype.change_tab_size = function(tab_size){
  var self = this;

  this.tab_size_pref.refreshAndSet(tab_size, self, self.show_reauth)

  this.editor_view.getSession().setTabSize(tab_size)
}

EditorController.prototype.block_saving = function(){
  var self = this;
  this.$.find('.editor_save_button').html(i18n("Saving")+"...")
  this.$.find('.editor_save_button').unbind('click')
  this.safe_to_quit = false
  $(window).off('keydown.save')
  $(window).on('keydown.save', function(event) {
    if (!( String.fromCharCode(event.which).toLowerCase() == 's' && event.ctrlKey) && !(event.which == 19)) return true;
    self.flash.warning(i18n("This file is already being saved. Calm down."), 3)
    event.preventDefault();
    return false;
  });  
  self.can_save = false;
}

EditorController.prototype.allow_saving = function(){
  var self = this;
  self.can_save = true
  this.$.find('.editor_save_button').html(i18n("Save"))
  this.$.find('.editor_save_button').click(function(){self.save()})
  this.safe_to_quit = true
  $(window).off('keydown.save')
  $(window).on('keydown.save', function(event) {
    if (!( String.fromCharCode(event.which).toLowerCase() == 's' && event.ctrlKey) && !(event.which == 19)) return true;
    self.save()
    event.preventDefault();
    return false;
  });
}

EditorController.prototype.show_file_explorer = function(){
  var self = this;
  this.open_menu()
  this.open_explorer()
}

EditorController.prototype.check_content_changed = function(){
  var self = this;

  if(!this.file.persisted){
    this.$.find('.editor_save_button').html(i18n("Save"))
    return
  }

  if(this.file.persisted && this.realtime_content){
    this.realtime_content.setText(this.editor_view.getValue());
  }
  this.file.set("data", this.editor_view.getValue());
  
  if(!(this.$.find('.editor_save_button').html() == i18n("Saving")+"...")){
    if(this.file.did_content_change()){
      this.$.find('.editor_save_button').html(i18n("Save"))
    }
    else{
      this.$.find('.editor_save_button').html(i18n("Saved"))
    }
  }
}

EditorController.prototype.set_wait = function(key, value){
  var self = this;
  this.ajax_defered_waiting[key] = value
}

EditorController.prototype.change_word_wrap = function(value){
  var self = this;

  this.word_wrap_pref.refreshAndSet(value, self, function(){self.show_reauth()});
  this.editor_view.getSession().setUseWrapMode(this.word_wrap_pref.getValue())
}


EditorController.prototype.select_theme = function(name){
  var self = this;
  var current_theme = this.theme_pref.getValue()
  if(!this.theme_pref.getValue()){
    current_theme = this.initial_theme
  }
  $("."+escape_jquery_selector("theme_"+current_theme)).removeClass("btn-primary")

  this.theme_pref.refreshAndSet(name, self, self.show_reauth)

  this.editor_view.setTheme(name)
  var check = this.$.find('#theme_check').detach()
  $("."+escape_jquery_selector("theme_"+name)).addClass("btn-primary")
  
}
   
EditorController.prototype.change_keybinding = function(keybinding){
  var self = this;
  if(keybinding == "vim"){
    this.editor_view.setKeyboardHandler("ace/keyboard/vim");
    if(!this.editor_view.showCommandLine){
      // we bind the vim write event to this controller
      ace.config.loadModule("ace/keyboard/vim", function(m) {
          var VimApi = require("ace/keyboard/vim").CodeMirror.Vim
          VimApi.defineEx("write", "w", function(cm, input) {
              self.save()
          })
      })
    }
  }
  else if(keybinding == "emacs"){
    this.editor_view.setKeyboardHandler("ace/keyboard/emacs");
  }
  else{
    this.editor_view.setKeyboardHandler();
  }

  StringPreference.find("keybinding").refreshAndSet(keybinding, self, self.show_reauth)
}


EditorController.prototype.init_collaboration = function(model){
  var self = this;
  try{
  var content = model.createString(self.file.data);
  model.getRoot().set("content", content);
  }catch(e){console.log("Error in collaboration init : "+e)}
}

EditorController.prototype.stop_collaboration = function(){
  var self = this;
  //Clear out the collaborators area      
  self.clear_collaborators();

  // remove any previous event listeners, if any
  if(self.realtime_content){
    self.realtime_content.removeAllEventListeners();
    self.realtime_content = undefined;
  }
  if(self.realtime_document) self.realtime_document.close();
  self.realtime_document = undefined;
}

EditorController.prototype.make_collaborative = function(){
  var self = this;

  self.stop_collaboration();

  gapi.drive.realtime.load(self.file.id, function(doc){
    self.realtime_document = doc;
    try{
    self.realtime_content = self.realtime_document.getModel().getRoot().get("content");


    self.realtime_content.addEventListener(
      gapi.drive.realtime.EventType.TEXT_INSERTED, 
      function(evt){
        self.file_content_added(evt)
      });
    
    self.realtime_content.addEventListener(
      gapi.drive.realtime.EventType.TEXT_DELETED, 
      function(evt){
        self.file_content_deleted(evt)
      });

    self.realtime_document.addEventListener(
      gapi.drive.realtime.EventType.COLLABORATOR_JOINED, 
      function(evt){
        self.add_collaborator(evt.collaborator);
      });

    self.realtime_document.addEventListener(
      gapi.drive.realtime.EventType.COLLABORATOR_LEFT, 
      function(evt){
        self.remove_collaborator(evt.collaborator);
      });
    
    self.display_collaborators()

    }catch(e){console.log(e)}
  }, 
  function(model) {self.init_collaboration(model)},
  function(error) {
    if(error.type == "token_refresh_required"){
      oauth_controller.do_auth();
    }
  }
  );
}

EditorController.prototype.clear_collaborators = function(collaborator){
  var self = this;
  $('.collaborators').html('');
}

EditorController.prototype.remove_collaborator = function(collaborator){
  var self = this;
  self.clear_realtime_user(collaborator.userId);
  $('#collaborator-'+collaborator.userId).remove();
}

EditorController.prototype.add_collaborator = function(collaborator) {
  var self = this;
  if(collaborator.isMe) return;
  var element = $("<span id='collaborator-"+collaborator.userId+"' class='label label-default' style='background-color:"+collaborator.color+"'>"+collaborator.displayName+"</span>");
  self.collaborators_colors[collaborator.userId] = collaborator.color;
  if(! $('.collaborators').has('#collaborator-'+collaborator.userId).length )
    $('.collaborators').append(element) ;

}

EditorController.prototype.display_collaborators = function(){
  var self = this;
  var collaborators = self.realtime_document.getCollaborators();
  self.collaborators_colors = {}
  for(var i in collaborators) {
    var collaborator = collaborators[i];
    self.add_collaborator(collaborator);
  }
}

EditorController.prototype.reset_collaboration = function() {
  var self = this;
  if(self.provider == "GoogleDrive"){
    self.stop_collaboration();
    self.init_collaboration();
  }
}

EditorController.prototype.file_content_added = function(evt){
  var self = this;
  if(!evt.isLocal){
    var start = self.editor_view.getSession().getDocument().indexToPosition(evt.index)
    self.editor_view.getSession().insert(start, evt.text)
    var nl_stripped = evt.text.replace('\n', '')
    if(nl_stripped !== "") {
      self.move_realtime_user(evt.userId, self.editor_view.getSession().getDocument().indexToPosition(evt.index+1));
    }
 }
  
}

EditorController.prototype.file_content_deleted = function(evt){
  var self = this;
  if(!evt.isLocal){
    var begin = self.editor_view.getSession().getDocument().indexToPosition(evt.index)
    var end = self.editor_view.getSession().getDocument().indexToPosition(evt.index+evt.text.length)
    var range = new Range(begin.row, begin.column, end.row, end.column)
    self.editor_view.getSession().remove({start:begin, end:end})

    var nl_stripped = evt.text.replace('\n', '')
    if(nl_stripped !== "") {
      self.move_realtime_user(evt.userId, self.editor_view.getSession().getDocument().indexToPosition(evt.index));
    }
  }
  
}

EditorController.prototype.move_realtime_user = function(userId, position){
  var self = this;
  self.clear_realtime_user(userId);
  self.editor_view.getSession().addGutterDecoration(position.row, userId+'-active')
  setTimeout(function(){
    $('.'+userId+'-active').css('background-color', self.collaborators_colors[userId]);
  }, 100);
}

EditorController.prototype.clear_realtime_user = function(userId){
  var self = this;
  $('.'+userId+'-active').css('background-color', '');
  for(var i=0; i<self.editor_view.getSession().getDocument().getLength();i++){
      self.editor_view.getSession().removeGutterDecoration(i, userId+'-active');
  }
}

EditorController.prototype.open_share_modal = function() {
  var self = this;
  if(self.file.persisted){
    oauth_controller.share_client.setItemIds([self.file.id]);
    oauth_controller.share_client.showSettingsDialog();
  }
  else {
    new Popup({message : i18n("You must save the file before you can share it.")});
  }
}

EditorController.prototype.options_show_callback = function() {
  var self = this;
  $("select").each(function(){
    if($(this).hasClass('keybinding_select')) {
      $(this).val(StringPreference.find("keybinding").getValue())
    }
    else if($(this).hasClass('tab_size_select')){
      $(this).val(StringPreference.find("ace_js_tab_size").getValue())
    }
  });

  self.fontSizeWidget.refreshFromPreference();
  
  if(BooleanPreference.find("word_wrap").getValue()){
    $('.word_wrap_checkbox').prop('checked', true);
  }
  else{
    $('.word_wrap_checkbox').prop('checked', false);
  }
  
}

EditorController.prototype.restart_app = function() {
  var self = this;
  new Popup({ message : i18n("Are you sure ?"), callback : function(result) {if(result) window.location.reload()}, confirm : true});
}

EditorController.prototype.browser_check = function() {
  var self = this;
  var isOpera = !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0;
      // Opera 8.0+ (UA detection to detect Blink/v8-powered Opera)
  var isFirefox = typeof InstallTrigger !== 'undefined';   // Firefox 1.0+
  var isSafari = Object.prototype.toString.call(window.HTMLElement).indexOf('Constructor') > 0;
      // At least Safari 3+: "[object HTMLElementConstructor]"
  var isChrome = !!window.chrome && !isOpera;              // Chrome 1+
  var isIE = /*@cc_on!@*/false || !!document.documentMode; // At least IE6

  if(isIE || isOpera) {
    self.flash.error(i18n("The browser you are using is completely untested with this app. Consider using another browser."));
  }
  else if(isFirefox || isSafari){
    self.flash.warning(i18n("The browser you are using is not officialy tested. The app should work but your milleage may vary."));
  }
  else if(isChrome){
    // All good :)
  }
  else {
    self.flash.error(i18n("Couldn't detect which browser you are using. The app should work but your milleage may vary."));
  }
}

EditorController.prototype.select_locale = function(locale){
  var self = this;
  setCookie("locale", locale, 365)
  
  new Popup({ message : i18n("Requires to restart the application to be effective. Proceed with restart?"), callback : function(result) {if(result) window.location.reload()}, confirm : true });
}

EditorController.prototype.detect_device = function(){
  var self = this;
  var client = new FingerbankClient();
  client.endpointFromCurrentUserAgent(function(endpoint){
    $('#current_device').html(endpoint.name);
  });
}
