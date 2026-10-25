using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace AutoWorld.PrivateCopy {
  public sealed class Pin {
    public readonly string Name, Sha256;
    public readonly long Size;
    public Pin(string name, long size, string sha256) { Name=name; Size=size; Sha256=sha256; }
  }
  // Fixture configuration is a library surface only. The production PS entrypoint never accepts it.
  public sealed class Configuration {
    public readonly string Parent, Sid, ParentOwner, Prefix;
    public readonly Pin[] Files;
    public Configuration(string parent, string sid, string parentOwner, string prefix, Pin[] files) {
      Parent=parent; Sid=sid; ParentOwner=parentOwner; Prefix=prefix; Files=(Pin[])files.Clone();
    }
  }
  public static class Native {
    const uint Read=0x80000000, Write=0x40000000, Delete=0x10000, ReadAttributes=0x80, ReadControl=0x20000, Sync=0x100000;
    const uint Directory=0x10, Reparse=0x400, Backup=0x02000000, OpenReparse=0x00200000;
    const uint ShareRead=1, ShareWrite=2, FileCreate=2, FileOpen=1, FileDirectory=1, NonDirectory=0x40, Synchronous=0x20, NtOpenReparse=0x200000;
    const string SystemSid="S-1-5-18";
    const int FullControl=0x1f01ff;
    [StructLayout(LayoutKind.Sequential)] struct Time { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] struct Info {
      public uint Attributes; public Time Creation, Access, Written; public uint Volume, SizeHigh, SizeLow, Links, IdHigh, IdLow;
      public ulong Id { get { return ((ulong)IdHigh<<32)|IdLow; } }
      public long Size { get { return checked((long)(((ulong)SizeHigh<<32)|SizeLow)); } }
    }
    [StructLayout(LayoutKind.Sequential)] struct Unicode { public ushort Length, Maximum; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct Attributes { public uint Length; public IntPtr Root, Name; public uint Flags; public IntPtr Security, Quality; }
    [StructLayout(LayoutKind.Sequential)] struct IoStatus { public IntPtr Status, Information; }
    [StructLayout(LayoutKind.Sequential)] struct Disposition { [MarshalAs(UnmanagedType.Bool)] public bool Delete; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle handle,uint access,ref Attributes attributes,out IoStatus status,IntPtr allocation,uint flags,uint share,uint disposition,uint options,IntPtr ea,uint eaLength);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,System.Text.StringBuilder buffer,uint count,uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle,System.Text.StringBuilder volume,uint volumeSize,out uint serial,out uint maximum,out uint flags,System.Text.StringBuilder fs,uint fsSize);
    [DllImport("kernel32.dll")] static extern uint GetFileType(SafeFileHandle handle);
    [DllImport("advapi32.dll")] static extern uint GetSecurityInfo(SafeFileHandle handle,uint type,uint information,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle handle,int information,ref Disposition disposition,uint size);
    static void Fail(string reason) { throw new InvalidOperationException("windows_private_copy_"+reason); }
    static bool Hex(string value,int length) { if(value==null||value.Length!=length)return false; foreach(char c in value)if(!(c>='0'&&c<='9'||c>='a'&&c<='f'))return false; return true; }
    static bool Leaf(string value) { if(String.IsNullOrEmpty(value)||value.Length>128)return false; foreach(char c in value)if(!(c>='a'&&c<='z'||c>='0'&&c<='9'||c=='-'||c=='.'))return false; return value!="."&&value!=".."&&!value.EndsWith("."); }
    static Info Information(SafeFileHandle handle,bool directory) {
      Info value=default(Info); if(handle==null||handle.IsInvalid||!GetFileInformationByHandle(handle,out value)||GetFileType(handle)!=1
        ||(value.Attributes&Reparse)!=0||((value.Attributes&Directory)!=0)!=directory||!directory&&value.Links!=1)Fail("identity_invalid");
      return value;
    }
    static string FinalPath(SafeFileHandle handle) {
      var buffer=new System.Text.StringBuilder(32768); uint length=GetFinalPathNameByHandleW(handle,buffer,(uint)buffer.Capacity,0);
      if(length==0||length>=buffer.Capacity)Fail("identity_invalid"); return buffer.ToString();
    }
    static void Security(SafeFileHandle handle,string expectedSid,bool directory) {
      IntPtr owner,group,dacl,sacl,descriptor; if(GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor)!=0)Fail("acl_invalid");
      try {
        uint length=GetSecurityDescriptorLength(descriptor); if(length<20||length>65536)Fail("acl_invalid");
        byte[] bytes=new byte[length]; Marshal.Copy(descriptor,bytes,0,bytes.Length); var security=new RawSecurityDescriptor(bytes,0);
        if(security.Owner==null||security.Owner.Value!=expectedSid||(security.ControlFlags&ControlFlags.DiscretionaryAclProtected)==0
          ||(security.ControlFlags&ControlFlags.DiscretionaryAclPresent)==0||security.DiscretionaryAcl==null||security.DiscretionaryAcl.Count!=2)Fail("acl_invalid");
        var sids=new HashSet<string>(); foreach(GenericAce raw in security.DiscretionaryAcl) {
          var ace=raw as CommonAce; var expectedFlags=directory?AceFlags.ContainerInherit|AceFlags.ObjectInherit:AceFlags.None;
          if(ace==null||ace.IsCallback||ace.AceQualifier!=AceQualifier.AccessAllowed||ace.AccessMask!=FullControl||ace.AceFlags!=expectedFlags
            ||(ace.SecurityIdentifier.Value!=SystemSid&&ace.SecurityIdentifier.Value!=WindowsIdentity.GetCurrent().User.Value)||!sids.Add(ace.SecurityIdentifier.Value))Fail("acl_invalid");
        }
      } finally { if(descriptor!=IntPtr.Zero)LocalFree(descriptor); }
    }
    static byte[] Descriptor(string sid,bool directory) {
      string flags=directory?"OICI":"";
      var descriptor=new RawSecurityDescriptor("O:"+sid+"D:P(A;"+flags+";FA;;;"+sid+")(A;"+flags+";FA;;;SY)");
      byte[] bytes=new byte[descriptor.BinaryLength];descriptor.GetBinaryForm(bytes,0);return bytes;
    }
    static SafeFileHandle Relative(SafeFileHandle parent,string leaf,uint access,uint share,bool directory,bool create,string sid,bool allowMissing=false) {
      if(!Leaf(leaf))Fail("arguments_invalid"); IntPtr name=IntPtr.Zero,unicode=IntPtr.Zero,security=IntPtr.Zero;
      try {
        name=Marshal.StringToHGlobalUni(leaf); var text=new Unicode{Length=checked((ushort)(leaf.Length*2)),Maximum=checked((ushort)((leaf.Length+1)*2)),Buffer=name};
        unicode=Marshal.AllocHGlobal(Marshal.SizeOf<Unicode>());Marshal.StructureToPtr(text,unicode,false);
        if(create){byte[] bytes=Descriptor(sid,directory);security=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,security,bytes.Length);}
        var attributes=new Attributes{Length=(uint)Marshal.SizeOf<Attributes>(),Root=parent.DangerousGetHandle(),Name=unicode,Flags=0x40|0x1000,Security=security};
        SafeFileHandle handle; IoStatus status;
        int result=NtCreateFile(out handle,access,ref attributes,out status,IntPtr.Zero,0,share,create?FileCreate:FileOpen,
          Synchronous|(directory?FileDirectory:NonDirectory|NtOpenReparse),IntPtr.Zero,0);
        if(allowMissing&&result==unchecked((int)0xc0000034)){if(handle!=null)handle.Dispose();return null;}
        if(result!=0||handle==null||handle.IsInvalid||(create&&status.Information.ToInt64()!=2)) { if(handle!=null)handle.Dispose();Fail("open_failed"); }
        return handle;
      } finally { if(name!=IntPtr.Zero)Marshal.FreeHGlobal(name);if(unicode!=IntPtr.Zero)Marshal.FreeHGlobal(unicode);if(security!=IntPtr.Zero)Marshal.FreeHGlobal(security); }
    }
    sealed class Guard:IDisposable {
      readonly List<SafeFileHandle> handles=new List<SafeFileHandle>(); readonly List<Info> identities=new List<Info>();
      readonly List<string> paths=new List<string>(); public readonly Configuration Config; public SafeFileHandle Parent {get{return handles[handles.Count-1];}}
      public Guard(Configuration config) {
        Config=config;
        try {
          if(Environment.OSVersion.Platform!=PlatformID.Win32NT||config==null||config.Sid!=WindowsIdentity.GetCurrent().User.Value
            ||config.Parent==null||config.Parent.Length<4||config.Parent[1]!=':'||config.Parent[2]!='\\'||config.Parent.StartsWith("\\")
            ||Path.GetFullPath(config.Parent)!=config.Parent||config.Parent.EndsWith("\\")||config.Files.Length!=2
            ||!Leaf(config.Prefix)||config.Prefix.EndsWith(".")||config.Files[0].Name!="candidate.tar"||config.Files[1].Name!="retention-receipt.json")Fail("arguments_invalid");
          foreach(Pin pin in config.Files)if(pin.Size<1||pin.Size>1073741824||!Hex(pin.Sha256,64))Fail("arguments_invalid");
          string root=config.Parent.Substring(0,3);var drive=new DriveInfo(root);if(drive.DriveType!=DriveType.Fixed||drive.DriveFormat!="NTFS")Fail("filesystem_invalid");
          SafeFileHandle first=CreateFileW("\\\\?\\"+root,ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,IntPtr.Zero,3,Backup|OpenReparse,IntPtr.Zero);
          if(first.IsInvalid){first.Dispose();Fail("open_failed");} Add(first,root);
          string current=root.TrimEnd('\\');foreach(string leaf in config.Parent.Substring(3).Split('\\')) {
            if(String.IsNullOrEmpty(leaf)||leaf=="."||leaf==".."||leaf.EndsWith(".")||leaf.EndsWith(" ")||leaf.Contains(":"))Fail("arguments_invalid");
            // Ancestors can contain mixed case and underscores; the owned leaves remain strictly closed.
            var handle=RelativeAncestor(Parent,leaf);current+="\\"+leaf;Add(handle,current);
          }
          Security(Parent,config.ParentOwner,true);Check();
        }catch{Dispose();throw;}
      }
      static SafeFileHandle RelativeAncestor(SafeFileHandle parent,string leaf) {
        IntPtr name=Marshal.StringToHGlobalUni(leaf),unicode=Marshal.AllocHGlobal(Marshal.SizeOf<Unicode>());
        try {
          var text=new Unicode{Length=checked((ushort)(leaf.Length*2)),Maximum=checked((ushort)((leaf.Length+1)*2)),Buffer=name};Marshal.StructureToPtr(text,unicode,false);
          var attributes=new Attributes{Length=(uint)Marshal.SizeOf<Attributes>(),Root=parent.DangerousGetHandle(),Name=unicode,Flags=0x40|0x1000};
          SafeFileHandle handle;IoStatus status;int result=NtCreateFile(out handle,ReadAttributes|ReadControl|Sync,ref attributes,out status,IntPtr.Zero,0,ShareRead|ShareWrite,FileOpen,Synchronous|FileDirectory,IntPtr.Zero,0);
          if(result!=0||handle==null||handle.IsInvalid){if(handle!=null)handle.Dispose();Fail("open_failed");}return handle;
        }finally{Marshal.FreeHGlobal(name);Marshal.FreeHGlobal(unicode);}
      }
      void Add(SafeFileHandle handle,string expected) {
        try {Info info=Information(handle,true);if(!String.Equals(FinalPath(handle),"\\\\?\\"+expected,StringComparison.OrdinalIgnoreCase))Fail("identity_invalid");
          var fs=new System.Text.StringBuilder(32);uint serial,maximum,flags;
          if(!GetVolumeInformationByHandleW(handle,null,0,out serial,out maximum,out flags,fs,(uint)fs.Capacity)||fs.ToString()!="NTFS"
            ||(flags&8)==0||serial!=info.Volume||identities.Count>0&&info.Volume!=identities[0].Volume)Fail("filesystem_invalid");
          handles.Add(handle);identities.Add(info);paths.Add(expected);
        }catch{handle.Dispose();throw;}
      }
      public void Check() {for(int index=0;index<handles.Count;index++){Info current=Information(handles[index],true);
        if(current.Id!=identities[index].Id||current.Volume!=identities[index].Volume||!String.Equals(FinalPath(handles[index]),"\\\\?\\"+paths[index],StringComparison.OrdinalIgnoreCase))Fail("identity_changed");}
        Security(Parent,Config.ParentOwner,true);
      }
      public void Dispose(){for(int index=handles.Count-1;index>=0;index--)handles[index].Dispose();handles.Clear();}
    }
    static bool Stable(Info left,Info right){return left.Id==right.Id&&left.Volume==right.Volume&&left.Size==right.Size&&left.Links==right.Links
      &&left.Attributes==right.Attributes&&left.Creation.Low==right.Creation.Low&&left.Creation.High==right.Creation.High&&left.Written.Low==right.Written.Low&&left.Written.High==right.Written.High;}
    static string Hash(Stream stream){using(var hash=SHA256.Create()){return Convert.ToHexString(hash.ComputeHash(stream)).ToLowerInvariant();}}
    // The native owner stays alive until validation/deletion finishes. FileStream disposes only this borrowed wrapper.
    static FileStream BorrowedStream(SafeFileHandle handle,FileAccess access){return new FileStream(new SafeFileHandle(handle.DangerousGetHandle(),false),access,1024*1024,false);}
    static Dictionary<string,object> FileProof(Pin pin,Info info,string sid){return new Dictionary<string,object>{{"name",pin.Name},{"size",pin.Size},{"sha256",pin.Sha256},{"fileId",info.Id.ToString("x16")},{"ownerSid",sid},{"protectedAcl",true},{"nlink",1}};}
    static Info ValidateFile(SafeFileHandle handle,Pin pin,string sid,Stream output) {
      Info before=Information(handle,false);if(before.Size!=pin.Size)Fail("bytes_invalid");Security(handle,sid,false);
      using(var stream=BorrowedStream(handle,FileAccess.Read)) {
        using(var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
          byte[] buffer=new byte[1024*1024];long count=0;int read;
          while((read=stream.Read(buffer,0,buffer.Length))!=0){count+=read;if(count>pin.Size)Fail("bytes_invalid");hash.AppendData(buffer,0,read);if(output!=null)output.Write(buffer,0,read);}
          if(count!=pin.Size||Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()!=pin.Sha256)Fail("bytes_invalid");
        }
        if(!Stable(before,Information(handle,false)))Fail("identity_changed");Security(handle,sid,false);
      }
      return before;
    }
    static Info WriteFile(SafeFileHandle parent,Pin pin,string sid,Stream input,bool publication,ulong expectedId=0) {
      SafeFileHandle handle=Relative(parent,pin.Name,Read|Write|Sync|(publication?Delete:0),0,false,!publication,sid);Info created=Information(handle,false);
      if(publication&&(created.Id!=expectedId||created.Size!=0)){handle.Dispose();Fail("identity_invalid");}
      try {
        Security(handle,sid,false);
        using(var stream=BorrowedStream(handle,FileAccess.ReadWrite)) {
          Security(handle,sid,false);byte[] buffer=new byte[1024*1024];long remaining=pin.Size;
          using(var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
            while(remaining>0){int read=input.Read(buffer,0,(int)Math.Min(buffer.Length,remaining));if(read==0)Fail("bytes_invalid");stream.Write(buffer,0,read);hash.AppendData(buffer,0,read);remaining-=read;}
            if(Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()!=pin.Sha256)Fail("bytes_invalid");
          }
          if(publication&&input.ReadByte()!=-1)Fail("bytes_invalid");stream.Flush(true);stream.Position=0;
          if(Hash(stream)!=pin.Sha256)Fail("bytes_invalid");Info final=Information(handle,false);
          if(final.Id!=created.Id||final.Volume!=created.Volume||final.Size!=pin.Size)Fail("identity_changed");Security(handle,sid,false);
        }
      } catch {
        if(publication) { if(handle.IsClosed)Fail("cleanup_uncertain");DeleteOwned(handle,created); }
        throw;
      } finally {handle.Dispose();}
      using(var reopened=Relative(parent,pin.Name,Read|Sync|(publication?Delete:0),publication?0:ShareRead,false,false,sid)) {
        Info observed=Information(reopened,false);if(observed.Id!=created.Id||observed.Volume!=created.Volume)Fail("identity_changed");
        try{return ValidateFile(reopened,pin,sid,null);}catch{if(publication)DeleteOwned(reopened,created);throw;}
      }
    }
    static void DeleteOwned(SafeFileHandle handle,Info owned) {
      Info current=Information(handle,false);if(current.Id!=owned.Id||current.Volume!=owned.Volume)Fail("cleanup_uncertain");
      var disposition=new Disposition{Delete=true};if(!SetFileInformationByHandle(handle,4,ref disposition,(uint)Marshal.SizeOf<Disposition>()))Fail("cleanup_uncertain");
    }
    static SafeFileHandle Child(Guard guard,string scope,bool create) {
      if(!Hex(scope,24))Fail("arguments_invalid");guard.Check();
      var child=Relative(guard.Parent,guard.Config.Prefix+scope,ReadAttributes|ReadControl|Sync,ShareRead|ShareWrite,true,create,guard.Config.Sid);
      try {Information(child,true);Security(child,guard.Config.Sid,true);guard.Check();return child;}catch{child.Dispose();throw;}
    }
    static Dictionary<string,object> Seal(Guard guard,SafeFileHandle child,string scope,Stream output) {
      Info before=Information(child,true);Security(child,guard.Config.Sid,true);guard.Check();var files=new List<Dictionary<string,object>>();
      foreach(Pin pin in guard.Config.Files){guard.Check();using(var handle=Relative(child,pin.Name,Read|Sync,ShareRead,false,false,guard.Config.Sid)){
        Info info=ValidateFile(handle,pin,guard.Config.Sid,output);if(info.Volume!=before.Volume)Fail("identity_changed");files.Add(FileProof(pin,info,guard.Config.Sid));}}
      Info after=Information(child,true);if(before.Id!=after.Id||before.Volume!=after.Volume)Fail("identity_changed");Security(child,guard.Config.Sid,true);guard.Check();
      return new Dictionary<string,object>{{"kind","WINDOWS_PRIVATE_COPY_PROOF_V1"},{"state","SEALED"},{"directory",guard.Config.Parent+"\\"+guard.Config.Prefix+scope},
        {"ownerSid",guard.Config.Sid},{"volumeSerial",before.Volume.ToString("x8")},{"directoryFileId",before.Id.ToString("x16")},{"protectedAcl",true},{"ntfs",true},{"reparse",false},{"files",files}};
    }
    static void DirectoryIdentity(SafeFileHandle child,string expected){if(!Hex(expected,16)||Information(child,true).Id.ToString("x16")!=expected)Fail("identity_invalid");}
    public static Dictionary<string,object> Execute(Configuration config,string operation,string scope,Stream input,Stream output,string expectedSha256,long expectedBytes,string expectedFileId=null,string expectedDirectoryFileId=null) {
      if(operation!="Receive"&&operation!="Export"&&operation!="Seal"&&operation!="PreparePublish"&&operation!="Publish"&&operation!="AbortPublish"||!Hex(scope,24))Fail("arguments_invalid");
      if(operation=="Publish"?(!Hex(expectedSha256,64)||expectedBytes<1||expectedBytes>65536):(expectedSha256!=null||expectedBytes!=0))Fail("arguments_invalid");
      bool publication=operation=="Publish"||operation=="AbortPublish";
      if(publication?(!Hex(expectedFileId,16)||!Hex(expectedDirectoryFileId,16)):(expectedFileId!=null||expectedDirectoryFileId!=null))Fail("arguments_invalid");
      using(var guard=new Guard(config))using(var child=Child(guard,scope,operation=="Receive")) {
        if(operation=="Receive") {foreach(Pin pin in config.Files){guard.Check();WriteFile(child,pin,config.Sid,input,false);}if(input.ReadByte()!=-1)Fail("bytes_invalid");}
        if(publication)DirectoryIdentity(child,expectedDirectoryFileId);
        if(operation=="AbortPublish") {
          using(var handle=Relative(child,"copy-receipt.json",Read|Delete|Sync,0,false,false,config.Sid,true)) {
            if(handle!=null){Info owned=Information(handle,false);Security(handle,config.Sid,false);
              if(owned.Id.ToString("x16")!=expectedFileId)Fail("identity_invalid");DeleteOwned(handle,owned);}
            DirectoryIdentity(child,expectedDirectoryFileId);guard.Check();
            return new Dictionary<string,object>{{"kind","WINDOWS_PRIVATE_COPY_ABORT_V1"},{"state",handle==null?"NOT_PRESENT":"REMOVED"},{"directoryFileId",expectedDirectoryFileId},{"fileId",expectedFileId}};
          }
        }
        if(operation=="PreparePublish") {
          Seal(guard,child,scope,null);var pin=new Pin("copy-receipt.json",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");Info created;
          using(var handle=Relative(child,pin.Name,Read|Write|Delete|Sync,0,false,true,config.Sid)) {
            created=Information(handle,false);using(var stream=BorrowedStream(handle,FileAccess.ReadWrite)){stream.Flush(true);}
            ValidateFile(handle,pin,config.Sid,null);
          }
          using(var reopened=Relative(child,pin.Name,Read|Sync,ShareRead,false,false,config.Sid)) {
            Info observed=ValidateFile(reopened,pin,config.Sid,null);if(observed.Id!=created.Id||observed.Volume!=created.Volume)Fail("identity_changed");
          }
          Seal(guard,child,scope,null);
          return new Dictionary<string,object>{{"kind","WINDOWS_PRIVATE_COPY_PREPARATION_V1"},{"state","PREPARED"},{"directoryFileId",Information(child,true).Id.ToString("x16")},{"file",FileProof(pin,created,config.Sid)}};
        }
        if(operation=="Publish") {
          Seal(guard,child,scope,null);var pin=new Pin("copy-receipt.json",expectedBytes,expectedSha256);Info info=WriteFile(child,pin,config.Sid,input,true,Convert.ToUInt64(expectedFileId,16));
          try {Seal(guard,child,scope,null);DirectoryIdentity(child,expectedDirectoryFileId);return new Dictionary<string,object>{{"kind","WINDOWS_PRIVATE_COPY_PUBLICATION_V1"},{"state","PUBLISHED"},{"directoryFileId",expectedDirectoryFileId},{"file",FileProof(pin,info,config.Sid)}};}
          catch {using(var handle=Relative(child,pin.Name,Read|Delete|Sync,0,false,false,config.Sid)){DeleteOwned(handle,info);}throw;}
        }
        return Seal(guard,child,scope,operation=="Export"?output:null);
      }
    }
  }
}
